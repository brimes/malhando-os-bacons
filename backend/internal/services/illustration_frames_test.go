package services

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"testing"
)

// tira sintética: fundo claro e um bloco escuro por painel, cada um de uma cor.
func tira(t *testing.T, n, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{245, 245, 245, 255}}, image.Point{}, draw.Src)
	pw := w / n
	for i := 0; i < n; i++ {
		c := color.RGBA{uint8(40 + i*50), 30, 120, 255}
		r := image.Rect(i*pw+pw/3, h/5, i*pw+2*pw/3, 4*h/5)
		draw.Draw(img, r, &image.Uniform{c}, image.Point{}, draw.Src)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestRecortarQuadros(t *testing.T) {
	for _, n := range []int{2, 3, 4} {
		saida, err := RecortarQuadros(tira(t, n, 840, 360), n)
		if err != nil {
			t.Fatalf("n=%d: %v", n, err)
		}
		if len(saida) != n {
			t.Fatalf("n=%d: %d quadros", n, len(saida))
		}
		var l0, h0 int
		for i, q := range saida {
			img, err := jpeg.Decode(bytes.NewReader(q))
			if err != nil {
				t.Fatalf("quadro %d não é JPEG: %v", i, err)
			}
			b := img.Bounds()
			if i == 0 {
				l0, h0 = b.Dx(), b.Dy()
			} else if b.Dx() != l0 || b.Dy() != h0 {
				t.Fatalf("quadros de tamanhos diferentes: %dx%d vs %dx%d", b.Dx(), b.Dy(), l0, h0)
			}
			// o bloco do painel i (cor própria) tem de estar no quadro i
			r, _, _, _ := img.At(b.Dx()/2, b.Dy()/2).RGBA()
			esperado := uint32(40 + i*50)
			if d := int(r>>8) - int(esperado); d < -12 || d > 12 {
				t.Fatalf("n=%d quadro %d: vermelho central %d, esperado ~%d", n, i, r>>8, esperado)
			}
		}
	}
}

func TestRecortarQuadrosRejeita(t *testing.T) {
	if _, err := RecortarQuadros(tira(t, 4, 400, 400), 1); err == nil {
		t.Fatal("1 quadro deve ser recusado")
	}
	// 4 painéis em imagem 8:1: painel absurdamente estreito/largo.
	if _, err := RecortarQuadros(tira(t, 4, 1600, 100), 4); err == nil {
		t.Fatal("proporção absurda deve falhar")
	}
	if _, err := RecortarQuadros([]byte("lixo"), 2); err == nil {
		t.Fatal("imagem inválida deve falhar")
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 600, 300)))
	if _, err := RecortarQuadros(buf.Bytes(), 2); err == nil {
		t.Fatal("imagem sem conteúdo deve falhar")
	}
}

func TestNormalizarDescricao(t *testing.T) {
	d := DescricaoMovimento{Equipment: "hip adduction machine", StartPosition: "legs apart", EndPosition: "legs together", Frames: 9}
	if err := d.Normalizar(); err != nil {
		t.Fatal(err)
	}
	if d.Frames != 4 || len(d.FrameDescriptions) != 4 || d.CameraView != "side" {
		t.Fatalf("normalização: %+v", d)
	}
	if err := (&DescricaoMovimento{}).Normalizar(); err == nil {
		t.Fatal("descrição vazia deve falhar")
	}
}
