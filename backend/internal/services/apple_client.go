package services

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AppleClient fala com o endpoint de token da Apple para duas coisas: trocar o
// authorizationCode por um refresh_token e revogá-lo quando a conta é excluída
// (a Apple exige a revogação, guideline 5.1.1(v)). As duas pedem um
// client_secret, um JWT ES256 assinado com a chave .p8 da conta de desenvolvedor.
type AppleClient struct {
	teamID   string
	keyID    string
	clientID string
	key      *ecdsa.PrivateKey
	baseURL  string
	client   *http.Client
	now      func() time.Time
}

// NewAppleClient devolve (nil, nil) quando não há credencial configurada: é o
// caso normal em dev, e o chamador segue sem revogar.
func NewAppleClient(teamID, keyID, clientID, privateKeyPEM string) (*AppleClient, error) {
	if teamID == "" || keyID == "" || strings.TrimSpace(privateKeyPEM) == "" {
		return nil, nil
	}
	// Variáveis de ambiente costumam trazer a quebra de linha escapada.
	privateKeyPEM = strings.ReplaceAll(privateKeyPEM, `\n`, "\n")
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return nil, errors.New("APPLE_PRIVATE_KEY não é um PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("APPLE_PRIVATE_KEY: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("APPLE_PRIVATE_KEY não é uma chave EC (.p8)")
	}
	return &AppleClient{
		teamID: teamID, keyID: keyID, clientID: clientID, key: key,
		baseURL: "https://appleid.apple.com",
		client:  &http.Client{Timeout: 10 * time.Second},
		now:     time.Now,
	}, nil
}

// ClientSecret monta o JWT de client_secret. A Apple aceita até 6 meses; como é
// gerado a cada chamada, 5 minutos bastam.
func (a *AppleClient) ClientSecret() (string, error) {
	now := a.now()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.RegisteredClaims{
		Issuer:    a.teamID,
		Subject:   a.clientID,
		Audience:  jwt.ClaimStrings{"https://appleid.apple.com"},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute)),
	})
	token.Header["kid"] = a.keyID
	return token.SignedString(a.key)
}

// ExchangeCode troca o authorizationCode (uso único, vale minutos) pelo
// refresh_token que depois permite revogar.
func (a *AppleClient) ExchangeCode(ctx context.Context, code string) (string, error) {
	secret, err := a.ClientSecret()
	if err != nil {
		return "", err
	}
	body, err := a.post(ctx, "/auth/token", url.Values{
		"client_id":     {a.clientID},
		"client_secret": {secret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
	})
	if err != nil {
		return "", err
	}
	var out struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.RefreshToken == "" {
		return "", errors.New("apple: resposta sem refresh_token")
	}
	return out.RefreshToken, nil
}

// Revoke invalida o refresh_token, desfazendo o vínculo do app com o ID Apple.
func (a *AppleClient) Revoke(ctx context.Context, refreshToken string) error {
	secret, err := a.ClientSecret()
	if err != nil {
		return err
	}
	_, err = a.post(ctx, "/auth/revoke", url.Values{
		"client_id":       {a.clientID},
		"client_secret":   {secret},
		"token":           {refreshToken},
		"token_type_hint": {"refresh_token"},
	})
	return err
}

func (a *AppleClient) post(ctx context.Context, path string, form url.Values) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("apple %s: %w", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		// O erro da Apple ({"error":"invalid_grant"}) não contém segredo.
		return nil, fmt.Errorf("apple %s: status %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}
