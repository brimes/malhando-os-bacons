package models

import "time"

// TermsStatus tells the app whether the disclaimer still has to be shown.
// Accepted is false both when nothing was ever accepted and when what was
// accepted is an older version of the text.
type TermsStatus struct {
	CurrentVersion  string     `json:"current_version"`
	Accepted        bool       `json:"accepted"`
	AcceptedAt      *time.Time `json:"accepted_at"`
	AcceptedVersion *string    `json:"accepted_version"`
}

type AcceptTermsRequest struct {
	Version string `json:"version"`
}

// LLMSettings is the safe view of user_llm_settings: it describes the stored
// key without ever carrying it. KeyPreview shows only the last characters, just
// enough for the person to recognise which key is saved.
type LLMSettings struct {
	Provider           string `json:"provider"`
	Model              string `json:"model"`
	Configured         bool   `json:"configured"`
	KeyPreview         string `json:"key_preview"`
	SubscriptionStatus string `json:"subscription_status"`
	UsingSharedCredits bool   `json:"using_shared_credits"`
}

type SaveLLMSettingsRequest struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	// APIKey empty or absent removes the stored key and puts the user back on
	// the shared credits.
	APIKey string `json:"api_key"`
}

type MockSubscriptionRequest struct {
	Action string `json:"action"`
}
