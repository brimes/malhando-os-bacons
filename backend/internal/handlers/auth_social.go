package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/config"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

// AuthServices reúne o que o login social e a redefinição de senha precisam e
// que depende de configuração externa. Cada campo pode ser nil: o recurso
// correspondente responde 503 e o resto da API funciona normalmente — o mesmo
// padrão dos vídeos de exercício, para que deployar o backend não dependa de
// segredos aplicados à mão.
type AuthServices struct {
	PasswordReset *services.PasswordResetService // sempre presente; Enabled() diz se há mailer
	Google        *services.OIDCVerifier         // nil sem GOOGLE_CLIENT_IDS
	Apple         *services.OIDCVerifier
	// AppleClient só existe com APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY. Sem ele o login
	// com Apple funciona; apenas não se guarda refresh_token nem se revoga.
	AppleClient *services.AppleClient
}

func NewAuthServices(cfg *config.Config, database *db.DB) AuthServices {
	var mailer services.Mailer
	switch {
	case cfg.BrevoAPIKey == "":
		slog.Warn("redefinição de senha desativada: BREVO_API_KEY não configurado")
	case cfg.BrevoSenderEmail == "":
		slog.Warn("redefinição de senha desativada: BREVO_SENDER_EMAIL não configurado")
	default:
		mailer = services.NewBrevoMailer(cfg.BrevoAPIKey, cfg.BrevoSenderEmail, cfg.BrevoSenderName)
	}
	svc := AuthServices{
		PasswordReset: services.NewPasswordResetService(services.NewPGPasswordResetStore(database), mailer, cfg.JWTSecret),
	}

	if len(cfg.GoogleClientIDs) == 0 {
		slog.Warn("login com Google desativado: GOOGLE_CLIENT_IDS não configurado")
	} else {
		svc.Google = services.NewGoogleVerifier(cfg.GoogleClientIDs)
	}

	audiences := []string{cfg.AppleBundleID}
	if cfg.AppleServiceID != "" {
		audiences = append(audiences, cfg.AppleServiceID)
	}
	svc.Apple = services.NewAppleVerifier(audiences)
	appleClient, err := services.NewAppleClient(cfg.AppleTeamID, cfg.AppleKeyID, cfg.AppleBundleID, cfg.ApplePrivateKey)
	switch {
	case err != nil:
		slog.Error("credenciais da Apple inválidas; o vínculo não será revogado ao excluir contas", "error", err)
	case appleClient == nil:
		slog.Warn("APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY não configurados: ao excluir uma conta o vínculo com a Apple não será revogado")
	default:
		svc.AppleClient = appleClient
	}
	return svc
}

type socialProvider struct {
	name     string
	idColumn string // coluna em users; vem de constante, nunca de entrada
}

var (
	providerGoogle = socialProvider{name: "google", idColumn: "google_id"}
	providerApple  = socialProvider{name: "apple", idColumn: "apple_id"}
)

func (h *AuthHandler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	if h.svc.Google == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "login com Google indisponível"})
		return
	}
	var req models.GoogleAuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.IDToken == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id_token is required"})
		return
	}
	identity, err := h.svc.Google.Verify(r.Context(), req.IDToken)
	if err != nil {
		slog.Warn("google token rejected", "error", err)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid google token"})
		return
	}
	user, status, msg := h.socialLogin(r.Context(), providerGoogle, identity, "", identity.Picture)
	if user == nil {
		writeJSON(w, status, map[string]string{"error": msg})
		return
	}
	h.writeAuthResponse(w, http.StatusOK, user)
}

func (h *AuthHandler) AppleLogin(w http.ResponseWriter, r *http.Request) {
	if h.svc.Apple == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "login com Apple indisponível"})
		return
	}
	var req models.AppleAuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.IdentityToken == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "identity_token is required"})
		return
	}
	identity, err := h.svc.Apple.Verify(r.Context(), req.IdentityToken)
	if err != nil {
		slog.Warn("apple token rejected", "error", err)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid apple token"})
		return
	}
	user, status, msg := h.socialLogin(r.Context(), providerApple, identity, strings.TrimSpace(req.Name), "")
	if user == nil {
		writeJSON(w, status, map[string]string{"error": msg})
		return
	}

	// Guardar o refresh_token é o que permite revogar na exclusão. O código vale
	// uma vez e poucos minutos, então a troca é tentada agora; falhar não impede
	// o login. Só quando o código veio e há credencial.
	if h.svc.AppleClient != nil && req.AuthorizationCode != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		refresh, err := h.svc.AppleClient.ExchangeCode(ctx, req.AuthorizationCode)
		cancel()
		if err != nil {
			slog.Warn("apple code exchange failed; revocation on delete will be skipped", "user_id", user.ID, "error", err)
		} else if _, err := h.db.Pool.Exec(r.Context(),
			`UPDATE users SET apple_refresh_token = $1 WHERE id = $2`, refresh, user.ID); err != nil {
			slog.Error("could not store apple refresh token", "user_id", user.ID, "error", err)
		}
	}
	h.writeAuthResponse(w, http.StatusOK, user)
}

// socialLogin resolve a conta de um token já validado, nesta ordem:
//  1. o id do provedor já vinculado — é a identidade estável, o e-mail pode mudar;
//  2. uma conta com o mesmo e-mail, vinculada agora, SÓ se o provedor garante
//     que o e-mail é verificado. Sem isso, quem cria uma conta no provedor com
//     o e-mail da vítima assumiria a conta dela;
//  3. conta nova.
//
// Devolve (nil, status, mensagem) quando não pode logar.
func (h *AuthHandler) socialLogin(ctx context.Context, p socialProvider, id *services.Identity, nameHint, picture string) (*models.User, int, string) {
	var user models.User

	err := scanUser(h.db.Pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE `+p.idColumn+` = $1`, id.Subject), &user)
	if err == nil {
		return &user, 0, ""
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		slog.Error("social login lookup failed", "provider", p.name, "error", err)
		return nil, http.StatusInternalServerError, "failed to sign in"
	}

	// A Apple pode mandar o e-mail só na primeira vez (e como relay privado, que
	// é um endereço válido como outro qualquer). Sem e-mail e sem vínculo
	// anterior não há como criar a conta.
	if id.Email == "" {
		return nil, http.StatusBadRequest, "o provedor não informou seu e-mail; entre com e-mail e senha"
	}
	if !id.EmailVerified {
		return nil, http.StatusUnauthorized, "o e-mail da conta não está verificado"
	}

	// Existe conta com este e-mail?
	var existingProviderID *string
	err = h.db.Pool.QueryRow(ctx,
		`SELECT id, `+p.idColumn+` FROM users WHERE email = $1`, id.Email).Scan(&user.ID, &existingProviderID)
	switch {
	case err == nil:
		if existingProviderID != nil && *existingProviderID != id.Subject {
			// A conta já está ligada a outra identidade deste provedor.
			return nil, http.StatusConflict, "este e-mail já está vinculado a outra conta " + p.name
		}
		err = scanUser(h.db.Pool.QueryRow(ctx,
			`UPDATE users SET `+p.idColumn+` = $1,
			        avatar_url = COALESCE(avatar_url, NULLIF($3, ''))
			 WHERE id = $2 RETURNING `+userColumns, id.Subject, user.ID, picture), &user)
		if err != nil {
			slog.Error("social login link failed", "provider", p.name, "error", err)
			return nil, http.StatusInternalServerError, "failed to sign in"
		}
		return &user, 0, ""
	case !errors.Is(err, pgx.ErrNoRows):
		slog.Error("social login email lookup failed", "provider", p.name, "error", err)
		return nil, http.StatusInternalServerError, "failed to sign in"
	}

	name := strings.TrimSpace(id.Name)
	if name == "" {
		name = nameHint
	}
	if name == "" {
		name = strings.SplitN(id.Email, "@", 2)[0]
	}
	if len(name) > 100 {
		name = name[:100]
	}
	err = scanUser(h.db.Pool.QueryRow(ctx,
		`INSERT INTO users (email, name, avatar_url, `+p.idColumn+`)
		 VALUES ($1, $2, NULLIF($3, ''), $4)
		 RETURNING `+userColumns, id.Email, name, picture, id.Subject), &user)
	if err != nil {
		slog.Error("social login create failed", "provider", p.name, "error", err)
		return nil, http.StatusInternalServerError, "failed to create user"
	}
	return &user, 0, ""
}

// revokeApple desfaz o vínculo com o ID Apple antes de a conta sumir. Nunca
// impede a exclusão: sem credencial ou sem refresh_token só registra o aviso.
func (h *AuthHandler) revokeApple(ctx context.Context, userID int64, refreshToken *string) {
	switch {
	case h.svc.AppleClient == nil:
		slog.Warn("conta Apple excluída sem revogar o vínculo: credenciais da Apple não configuradas", "user_id", userID)
	case refreshToken == nil || *refreshToken == "":
		slog.Warn("conta Apple excluída sem revogar o vínculo: não há refresh_token guardado", "user_id", userID)
	default:
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if err := h.svc.AppleClient.Revoke(ctx, *refreshToken); err != nil {
			slog.Error("falha ao revogar o token da Apple; a conta será excluída mesmo assim", "user_id", userID, "error", err)
		}
	}
}
