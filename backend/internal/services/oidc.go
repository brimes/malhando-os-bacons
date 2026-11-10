package services

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	GoogleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"
	AppleJWKSURL  = "https://appleid.apple.com/auth/keys"
	AppleIssuer   = "https://appleid.apple.com"
)

// GoogleIssuers: o Google emite com as duas grafias.
var GoogleIssuers = []string{"https://accounts.google.com", "accounts.google.com"}

// Identity é o que interessa do token de um provedor, já validado.
type Identity struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Picture       string
}

// flexBool lê o email_verified, que o Google manda como booleano e a Apple
// às vezes como a string "true".
type flexBool bool

func (b *flexBool) UnmarshalJSON(data []byte) error {
	switch strings.Trim(string(data), `"`) {
	case "true":
		*b = true
	default:
		*b = false
	}
	return nil
}

type oidcClaims struct {
	jwt.RegisteredClaims
	Email         string   `json:"email"`
	EmailVerified flexBool `json:"email_verified"`
	Name          string   `json:"name"`
	Picture       string   `json:"picture"`
}

// OIDCVerifier valida id tokens RS256 contra o JWKS do provedor: assinatura,
// emissor, audiência (qualquer item da lista) e expiração.
type OIDCVerifier struct {
	jwksURL   string
	issuers   []string
	audiences []string
	client    *http.Client

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

const (
	jwksTTL = time.Hour
	// Chave desconhecida força um novo fetch (rotação de chaves), mas não mais
	// que isso por intervalo: um kid inventado não pode virar martelo no provedor.
	jwksMinRefetch = time.Minute
)

func NewOIDCVerifier(jwksURL string, issuers, audiences []string) *OIDCVerifier {
	return &OIDCVerifier{
		jwksURL:   jwksURL,
		issuers:   issuers,
		audiences: audiences,
		client:    &http.Client{Timeout: 10 * time.Second},
	}
}

func NewGoogleVerifier(clientIDs []string) *OIDCVerifier {
	return NewOIDCVerifier(GoogleJWKSURL, GoogleIssuers, clientIDs)
}

func NewAppleVerifier(audiences []string) *OIDCVerifier {
	return NewOIDCVerifier(AppleJWKSURL, []string{AppleIssuer}, audiences)
}

var ErrInvalidIDToken = errors.New("invalid id token")

func (v *OIDCVerifier) Verify(ctx context.Context, raw string) (*Identity, error) {
	if len(v.audiences) == 0 {
		return nil, errors.New("no audiences configured")
	}
	claims := &oidcClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("token without kid")
		}
		return v.key(ctx, kid)
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(time.Minute),
	)
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("%w: %v", ErrInvalidIDToken, err)
	}
	if !containsString(v.issuers, claims.Issuer) {
		return nil, fmt.Errorf("%w: issuer %q", ErrInvalidIDToken, claims.Issuer)
	}
	audOK := false
	for _, aud := range claims.Audience {
		if containsString(v.audiences, aud) {
			audOK = true
			break
		}
	}
	if !audOK {
		return nil, fmt.Errorf("%w: audience", ErrInvalidIDToken)
	}
	if claims.Subject == "" {
		return nil, fmt.Errorf("%w: empty subject", ErrInvalidIDToken)
	}
	return &Identity{
		Subject:       claims.Subject,
		Email:         strings.ToLower(strings.TrimSpace(claims.Email)),
		EmailVerified: bool(claims.EmailVerified),
		Name:          strings.TrimSpace(claims.Name),
		Picture:       claims.Picture,
	}, nil
}

func containsString(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

func (v *OIDCVerifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	if key, ok := v.keys[kid]; ok && time.Since(v.fetchedAt) < jwksTTL {
		return key, nil
	}
	if v.keys != nil && time.Since(v.fetchedAt) < jwksMinRefetch {
		if key, ok := v.keys[kid]; ok {
			return key, nil
		}
		return nil, fmt.Errorf("unknown key id %q", kid)
	}
	keys, err := v.fetch(ctx)
	if err != nil {
		// Com o provedor fora do ar, uma chave já conhecida segue valendo.
		if key, ok := v.keys[kid]; ok {
			return key, nil
		}
		return nil, err
	}
	v.keys, v.fetchedAt = keys, time.Now()
	key, ok := keys[kid]
	if !ok {
		return nil, fmt.Errorf("unknown key id %q", kid)
	}
	return key, nil
}

type jwksDoc struct {
	Keys []struct {
		Kty string `json:"kty"`
		Kid string `json:"kid"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

func (v *OIDCVerifier) fetch(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch jwks: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch jwks: status %d", resp.StatusCode)
	}
	var doc jwksDoc
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, fmt.Errorf("decode jwks: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" || k.Kid == "" {
			continue
		}
		n, err1 := base64.RawURLEncoding.DecodeString(k.N)
		e, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil || len(n) == 0 || len(e) == 0 {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	if len(keys) == 0 {
		return nil, errors.New("jwks without usable keys")
	}
	return keys, nil
}
