package services

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type oidcFixture struct {
	key *rsa.PrivateKey
	srv *httptest.Server
}

func newOIDCFixture(t *testing.T) *oidcFixture {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "kid": "k1", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(srv.Close)
	return &oidcFixture{key: key, srv: srv}
}

func (f *oidcFixture) sign(t *testing.T, kid string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(f.key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func goodClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"iss": "https://accounts.google.com", "aud": "web-id", "sub": "sub-1",
		"email": "Ana@Example.com", "email_verified": true, "name": "Ana",
		"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(),
	}
}

func TestOIDCVerifyAcceptsValidTokenAndAnyAudienceInList(t *testing.T) {
	f := newOIDCFixture(t)
	v := NewOIDCVerifier(f.srv.URL, GoogleIssuers, []string{"ios-id", "web-id", "android-id"})
	id, err := v.Verify(context.Background(), f.sign(t, "k1", goodClaims()))
	if err != nil {
		t.Fatal(err)
	}
	if id.Subject != "sub-1" || id.Email != "ana@example.com" || !id.EmailVerified || id.Name != "Ana" {
		t.Fatalf("identidade inesperada: %+v", id)
	}
}

func TestOIDCVerifyRejections(t *testing.T) {
	f := newOIDCFixture(t)
	v := NewOIDCVerifier(f.srv.URL, GoogleIssuers, []string{"web-id"})
	mutate := func(fn func(c jwt.MapClaims)) string {
		c := goodClaims()
		fn(c)
		return f.sign(t, "k1", c)
	}
	cases := map[string]string{
		"audiência errada": mutate(func(c jwt.MapClaims) { c["aud"] = "outro-app" }),
		"emissor errado":   mutate(func(c jwt.MapClaims) { c["iss"] = "https://evil.example" }),
		"expirado":         mutate(func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() }),
		"sem exp":          mutate(func(c jwt.MapClaims) { delete(c, "exp") }),
		"sem sub":          mutate(func(c jwt.MapClaims) { delete(c, "sub") }),
		"kid desconhecido": f.sign(t, "zzz", goodClaims()),
		"lixo":             "nao.e.jwt",
	}
	for name, tok := range cases {
		if _, err := v.Verify(context.Background(), tok); err == nil {
			t.Errorf("%s: deveria ser recusado", name)
		}
	}

	// Assinado por outra chave com o mesmo kid.
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, goodClaims())
	tok.Header["kid"] = "k1"
	forged, _ := tok.SignedString(other)
	if _, err := v.Verify(context.Background(), forged); err == nil {
		t.Error("assinatura de outra chave deveria ser recusada")
	}
	// alg=none.
	none := jwt.NewWithClaims(jwt.SigningMethodNone, goodClaims())
	none.Header["kid"] = "k1"
	noneStr, _ := none.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, err := v.Verify(context.Background(), noneStr); err == nil {
		t.Error("alg=none deveria ser recusado")
	}
}

func TestOIDCEmailVerifiedAsStringAndAppleIssuer(t *testing.T) {
	f := newOIDCFixture(t)
	v := NewOIDCVerifier(f.srv.URL, []string{AppleIssuer}, []string{"net.brimes.mob"})
	c := goodClaims()
	c["iss"], c["aud"], c["email_verified"] = AppleIssuer, "net.brimes.mob", "true"
	id, err := v.Verify(context.Background(), f.sign(t, "k1", c))
	if err != nil || !id.EmailVerified {
		t.Fatalf("email_verified como string 'true' deve valer: %v %+v", err, id)
	}
	c["email_verified"] = false
	id, err = v.Verify(context.Background(), f.sign(t, "k1", c))
	if err != nil || id.EmailVerified {
		t.Fatalf("email_verified false deve ser preservado: %v %+v", err, id)
	}
}

func TestAppleClientSecretIsES256WithTeamAndKey(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	pemStr := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	// Variável de ambiente com \n escapado também deve funcionar.
	escaped := strings.ReplaceAll(strings.TrimSpace(pemStr), "\n", `\n`)
	a, err := NewAppleClient("TEAM123", "KEY123", "net.brimes.mob", escaped)
	if err != nil || a == nil {
		t.Fatalf("cliente: %v", err)
	}
	secret, err := a.ClientSecret()
	if err != nil {
		t.Fatal(err)
	}
	claims := jwt.RegisteredClaims{}
	tok, err := jwt.ParseWithClaims(secret, &claims, func(*jwt.Token) (interface{}, error) { return &key.PublicKey, nil },
		jwt.WithValidMethods([]string{"ES256"}))
	if err != nil || !tok.Valid {
		t.Fatalf("client_secret inválido: %v", err)
	}
	if tok.Header["kid"] != "KEY123" || claims.Issuer != "TEAM123" || claims.Subject != "net.brimes.mob" ||
		len(claims.Audience) != 1 || claims.Audience[0] != "https://appleid.apple.com" {
		t.Fatalf("claims inesperados: %v %+v", tok.Header, claims)
	}
}

func TestAppleClientAbsentWithoutConfig(t *testing.T) {
	if a, err := NewAppleClient("", "", "x", ""); a != nil || err != nil {
		t.Fatalf("sem config deve ser (nil, nil), veio %v %v", a, err)
	}
}
