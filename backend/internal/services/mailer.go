package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"time"
)

// Mailer envia o e-mail de redefinição de senha. É interface para que o fluxo
// possa ser testado sem rede.
type Mailer interface {
	SendPasswordResetCode(ctx context.Context, to, name, code string, validFor time.Duration) error
}

const brevoEndpoint = "https://api.brevo.com/v3/smtp/email"

// BrevoMailer fala com a API HTTP transacional do Brevo direto pela stdlib: é um
// POST com JSON, e um SDK não traria nada além de dependência.
type BrevoMailer struct {
	apiKey      string
	senderEmail string
	senderName  string
	endpoint    string
	client      *http.Client
}

func NewBrevoMailer(apiKey, senderEmail, senderName string) *BrevoMailer {
	if senderName == "" {
		senderName = "MOB"
	}
	return &BrevoMailer{
		apiKey:      apiKey,
		senderEmail: senderEmail,
		senderName:  senderName,
		endpoint:    brevoEndpoint,
		client:      &http.Client{Timeout: 15 * time.Second},
	}
}

type brevoAddress struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type brevoRequest struct {
	Sender      brevoAddress   `json:"sender"`
	To          []brevoAddress `json:"to"`
	Subject     string         `json:"subject"`
	HTMLContent string         `json:"htmlContent"`
	TextContent string         `json:"textContent"`
}

func (m *BrevoMailer) SendPasswordResetCode(ctx context.Context, to, name, code string, validFor time.Duration) error {
	subject, htmlBody, textBody := PasswordResetEmail(name, code, validFor)
	payload, err := json.Marshal(brevoRequest{
		Sender:      brevoAddress{Email: m.senderEmail, Name: m.senderName},
		To:          []brevoAddress{{Email: to}},
		Subject:     subject,
		HTMLContent: htmlBody,
		TextContent: textBody,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("api-key", m.apiKey)
	req.Header.Set("accept", "application/json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.client.Do(req)
	if err != nil {
		// O erro do net/http cita a URL, nunca o header com a chave.
		return fmt.Errorf("brevo: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		// Só status + code/message: o corpo inteiro pode ecoar dados da requisição.
		var apiErr struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&apiErr)
		return fmt.Errorf("brevo: status %d code=%q message=%q", resp.StatusCode, apiErr.Code, apiErr.Message)
	}
	return nil
}

// PasswordResetEmail monta assunto, HTML e texto. O código só é dígito, então
// não há o que escapar nele; o nome vem do usuário e é escapado.
func PasswordResetEmail(name, code string, validFor time.Duration) (subject, htmlBody, textBody string) {
	minutes := int(validFor.Minutes())
	greeting := "Olá"
	if name != "" {
		greeting = "Olá, " + name
	}
	subject = "Seu código para redefinir a senha do MOB"
	textBody = fmt.Sprintf("%s!\n\nSeu código para redefinir a senha do MOB é: %s\n\n"+
		"Ele vale por %d minutos e só pode ser usado uma vez. Digite-o no app, na tela de redefinição.\n\n"+
		"Se não foi você quem pediu, ignore este e-mail: sua senha continua a mesma.\n\nMOB - Malhando os Bacons\n",
		greeting, code, minutes)
	htmlBody = fmt.Sprintf(`<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px;font-size:16px">%s!</p>
<p style="margin:0 0 16px;font-size:16px">Seu código para redefinir a senha do MOB é:</p>
<p style="margin:0 0 20px;font-size:34px;font-weight:700;letter-spacing:8px;text-align:center">%s</p>
<p style="margin:0 0 12px;font-size:14px;color:#52525b">Ele vale por %d minutos e só pode ser usado uma vez. Digite-o no app, na tela de redefinição.</p>
<p style="margin:0;font-size:14px;color:#52525b">Se não foi você quem pediu, ignore este e-mail: sua senha continua a mesma.</p>
</div></body></html>`, html.EscapeString(greeting), code, minutes)
	return subject, htmlBody, textBody
}
