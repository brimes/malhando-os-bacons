package handlers

import (
	"bytes"
	"embed"
	"net/http"
	"time"
)

// The Play Console requires a privacy policy reachable at a public URL, without
// login. Serving it from the API keeps it versioned with the code that decides
// what is actually collected — a policy hosted elsewhere drifts from the schema
// the moment a migration adds a column.
//
//go:embed legal_privacy.html legal_support.html
var legalPages embed.FS

// privacyLastModified doubles as the cache validator. Bumping it is the reminder
// that the page and the data inventory have to move together.
var privacyLastModified = time.Date(2026, time.September, 23, 0, 0, 0, 0, time.UTC)

// supportLastModified serves the same purpose for the support page.
var supportLastModified = time.Date(2026, time.September, 2, 0, 0, 0, 0, time.UTC)

type LegalHandler struct{}

func NewLegalHandler() *LegalHandler {
	return &LegalHandler{}
}

func (h *LegalHandler) Privacy(w http.ResponseWriter, r *http.Request) {
	page, err := legalPages.ReadFile("legal_privacy.html")
	if err != nil {
		http.Error(w, "privacy policy unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// A store reviewer and a crawler will both fetch this; an hour is plenty and
	// keeps an update from taking a day to show up.
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeContent(w, r, "privacidade.html", privacyLastModified, bytes.NewReader(page))
}

// Support is the URL the App Store requires on every version. It has to answer
// without a login: the reviewer opens it before there is an account, and so does
// anyone who cannot get past the login screen — which is exactly when a support
// page is worth having.
func (h *LegalHandler) Support(w http.ResponseWriter, r *http.Request) {
	page, err := legalPages.ReadFile("legal_support.html")
	if err != nil {
		http.Error(w, "support page unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeContent(w, r, "suporte.html", supportLastModified, bytes.NewReader(page))
}
