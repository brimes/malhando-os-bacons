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
//go:embed legal_privacy.html
var legalPages embed.FS

// privacyLastModified doubles as the cache validator. Bumping it is the reminder
// that the page and the data inventory have to move together.
var privacyLastModified = time.Date(2026, time.July, 30, 0, 0, 0, 0, time.UTC)

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
