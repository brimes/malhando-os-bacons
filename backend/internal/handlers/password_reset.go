package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

// forgotPasswordReply é idêntica para e-mail com conta, sem conta ou acima do
// limite de pedidos: a resposta não pode servir para descobrir quem tem conta.
const forgotPasswordReply = "Se houver uma conta com este e-mail, enviamos um código de 6 dígitos. Ele vale por 15 minutos."

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req models.ForgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if !h.svc.PasswordReset.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "recuperação de senha indisponível no momento"})
		return
	}
	// E-mail malformado não tem conta; mesma resposta, sem consultar o banco.
	if validEmail(req.Email) {
		if err := h.svc.PasswordReset.RequestCode(r.Context(), req.Email); err != nil {
			slog.Error("forgot password failed", "error", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": forgotPasswordReply})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req models.ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Code = strings.TrimSpace(req.Code)
	if len(req.NewPassword) < 8 || len(req.NewPassword) > 72 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be between 8 and 72 characters"})
		return
	}
	userID, err := h.svc.PasswordReset.Reset(r.Context(), req.Email, req.Code, req.NewPassword)
	switch {
	case err == nil:
		h.invalidateVersion(userID)
		writeJSON(w, http.StatusOK, map[string]string{"message": "Senha redefinida. Entre com a nova senha."})
	case errors.Is(err, services.ErrInvalidResetCode):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "código inválido ou expirado"})
	default:
		slog.Error("reset password failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to reset password"})
	}
}
