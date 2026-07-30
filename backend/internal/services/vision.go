package services

import (
	"context"
	"errors"
)

// ErrVisionNotSupported means the configured provider cannot see images.
// Callers turn it into a message for the user instead of a generic failure.
var ErrVisionNotSupported = errors.New("the configured assistant provider does not support images")

// ImagePart is one photo attached to a vision call.
type ImagePart struct {
	MIMEType string
	Data     []byte
}

// VisionGenerator is implemented only by providers that accept images
// alongside the prompt. Split from StructuredGenerator, the same way
// ChatGenerator is split from it, so a provider that cannot see keeps
// compiling untouched and callers degrade to ErrVisionNotSupported instead of
// failing to build.
type VisionGenerator interface {
	GenerateWithImages(ctx context.Context, system, prompt string, images []ImagePart, schema map[string]any, out any) error
}
