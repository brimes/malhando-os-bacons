package services

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"strings"
)

// Ilustração do movimento: em vez de uma imagem só a partir do nome, o
// assistente primeiro descreve o aparelho e o movimento (texto), e só então
// uma imagem com N quadros em fileira é gerada e recortada.

const (
	MinQuadrosIlustracao = 2
	MaxQuadrosIlustracao = 4
)

// DescricaoMovimento é a descrição estruturada do exercício, em inglês, que
// alimenta o prompt da imagem e fica gravada como auditoria.
type DescricaoMovimento struct {
	Equipment         string   `json:"equipment"`
	StartPosition     string   `json:"start_position"`
	EndPosition       string   `json:"end_position"`
	MovingJoint       string   `json:"moving_joint"`
	CameraView        string   `json:"camera_view"`
	FrameDescriptions []string `json:"frame_descriptions"`
	Frames            int      `json:"frames"`
}

// EsquemaDescricaoMovimento é o JSON Schema da resposta de descrição.
func EsquemaDescricaoMovimento() map[string]any { return esquemaDescricaoMovimento }

var esquemaDescricaoMovimento = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"equipment":      map[string]any{"type": "string"},
		"start_position": map[string]any{"type": "string"},
		"end_position":   map[string]any{"type": "string"},
		"moving_joint":   map[string]any{"type": "string"},
		"camera_view": map[string]any{
			"type": "string",
			"enum": []any{"front", "side", "three_quarter", "back"},
		},
		"frames": map[string]any{"type": "integer"},
		"frame_descriptions": map[string]any{
			"type":  "array",
			"items": map[string]any{"type": "string"},
		},
	},
	"required": []any{"equipment", "start_position", "end_position", "moving_joint",
		"camera_view", "frames", "frame_descriptions"},
	"additionalProperties": false,
}

const PromptDescricaoMovimento = `You are a strength-training coach and technical illustrator briefing an artist.
Given a gym exercise name, describe it precisely so an illustrator cannot pick the wrong machine or the wrong movement.
Answer in English, short and concrete, no marketing words.

Fields:
- equipment: the EXACT apparatus and how the body sits or stands on it, including pad/lever/handle placement and which side of the limbs the pads touch. Example: "hip adduction machine: seated, back pad upright, two padded levers on the INNER side of the knees, legs start spread apart and squeeze together". If it is free weights or bodyweight, say which weights and where they are held.
- start_position / end_position: body and equipment state at the start and at the end of one repetition.
- moving_joint: the joint(s) that move and in which direction.
- camera_view: the single camera angle that shows the movement best. "front" for hip adduction/abduction, lateral raises and flyes; "side" for bench press, squats, curls, rows, deadlifts; "three_quarter" if neither is clearly better; "back" for movements seen from behind.
- frames: how many key frames (2 to 4) are the minimum that make the movement clear. Use 2 for a simple back-and-forth, 3 when a middle position matters, 4 only for multi-phase movements.
- frame_descriptions: exactly "frames" strings, in order, each describing the pose and equipment state of that frame in one sentence.

Exactly ONE person appears. Never describe a different machine than the one named, and never invent a second person.`

// Normalizar valida e corrige o que o modelo devolveu. Devolve erro quando a
// descrição não serve para desenhar (campos essenciais vazios).
func (d *DescricaoMovimento) Normalizar() error {
	d.Equipment = strings.TrimSpace(d.Equipment)
	d.StartPosition = strings.TrimSpace(d.StartPosition)
	d.EndPosition = strings.TrimSpace(d.EndPosition)
	d.MovingJoint = strings.TrimSpace(d.MovingJoint)
	if d.Equipment == "" || d.StartPosition == "" || d.EndPosition == "" {
		return errors.New("descrição do movimento incompleta")
	}
	switch d.CameraView {
	case "front", "side", "three_quarter", "back":
	default:
		d.CameraView = "side"
	}
	var quadros []string
	for _, q := range d.FrameDescriptions {
		if q = strings.TrimSpace(q); q != "" {
			quadros = append(quadros, q)
		}
	}
	n := d.Frames
	if n == 0 {
		n = len(quadros)
	}
	if n < MinQuadrosIlustracao {
		n = MinQuadrosIlustracao
	}
	if n > MaxQuadrosIlustracao {
		n = MaxQuadrosIlustracao
	}
	// Descrições faltando: o primeiro e o último quadro sempre existem (início
	// e fim); os do meio viram "intermediário" em vez de inventar.
	if len(quadros) != n {
		quadros = make([]string, n)
		quadros[0] = d.StartPosition
		quadros[n-1] = d.EndPosition
		for i := 1; i < n-1; i++ {
			quadros[i] = "intermediate position between the start and the end of the movement"
		}
	}
	d.FrameDescriptions = quadros
	d.Frames = n
	return nil
}

var nomesDeVista = map[string]string{
	"front":         "straight FRONT view (camera facing the person)",
	"side":          "pure SIDE profile view",
	"three_quarter": "three-quarter view",
	"back":          "view from BEHIND",
}

// ProporcaoTira escolhe a proporção da imagem inteira para que cada painel
// fique em pé (uma pessoa de corpo inteiro), com os proporções que o Gemini aceita.
func ProporcaoTira(quadros int) string {
	if quadros <= 2 {
		return "3:2"
	}
	return "21:9"
}

// PromptTiraDeQuadros monta o prompt da imagem única com N quadros em fileira.
func PromptTiraDeQuadros(nome string, d DescricaoMovimento) string {
	var b strings.Builder
	fmt.Fprintf(&b, "A single wide image: exactly %d panels arranged in ONE horizontal row, left to right, showing the key frames of one repetition of the gym exercise %q. ", d.Frames, nome)
	fmt.Fprintf(&b, "All panels have EQUAL width, separated by an equal empty gap, with no borders, frames, lines or dividers. ")
	fmt.Fprintf(&b, "Every panel shows the SAME single person (same face, hair, body, outfit), the SAME equipment in the same place, the same camera distance and framing, and the same plain light solid background; only the pose changes between panels. Exactly one person per panel, full body and the full equipment visible, nothing cropped. ")
	fmt.Fprintf(&b, "Camera: %s.\n", nomesDeVista[d.CameraView])
	fmt.Fprintf(&b, "Equipment (must be exactly this, no other machine): %s.\n", d.Equipment)
	fmt.Fprintf(&b, "Moving joint: %s.\n", d.MovingJoint)
	for i, q := range d.FrameDescriptions {
		fmt.Fprintf(&b, "Panel %d: %s\n", i+1, q)
	}
	b.WriteString("Clean flat-style didactic illustration, anatomically correct posture. Absolutely no text, no letters, no numbers, no arrows, no captions, no labels, no watermarks anywhere in the image.")
	return b.String()
}

func distanciaDeCor(a, b [3]int) int {
	d := 0
	for i := range a {
		x := a[i] - b[i]
		if x < 0 {
			x = -x
		}
		d += x
	}
	return d
}

// RecortarQuadros divide a tira em n quadros de largura igual e devolve cada
// um como JPEG q82. A largura vem da contagem pedida, não de detecção; o que é
// detectado é o fundo, para aparar a mesma margem em todos os quadros (as
// bordas laterais por proporção fixa, as verticais pela caixa do conteúdo).
func RecortarQuadros(data []byte, n int) ([][]byte, error) {
	if n < MinQuadrosIlustracao || n > MaxQuadrosIlustracao {
		return nil, fmt.Errorf("número de quadros inválido: %d", n)
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("imagem ilegível: %w", err)
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	larguraQuadro := w / n
	// Painéis em pé ou quadrados; uma tira quase quadrada com 4 painéis (ou muito
	// achatada) significa que o modelo ignorou a fileira.
	if larguraQuadro < 64 || h < 64 {
		return nil, errors.New("imagem pequena demais para recortar")
	}
	razao := float64(larguraQuadro) / float64(h)
	if razao < 0.25 || razao > 1.6 {
		return nil, fmt.Errorf("proporção da tira incompatível com %d quadros (%dx%d)", n, w, h)
	}

	pixel := func(x, y int) [3]int {
		r, g, bl, _ := img.At(b.Min.X+x, b.Min.Y+y).RGBA()
		return [3]int{int(r >> 8), int(g >> 8), int(bl >> 8)}
	}
	// Fundo = média dos quatro cantos.
	var fundo [3]int
	for _, c := range [][2]int{{0, 0}, {w - 1, 0}, {0, h - 1}, {w - 1, h - 1}} {
		p := pixel(c[0], c[1])
		for i := range fundo {
			fundo[i] += p[i] / 4
		}
	}
	// Faixa vertical que contém conteúdo em qualquer quadro.
	const limiar = 60
	passo := 2
	topo, base := h, -1
	for y := 0; y < h; y += passo {
		achou := false
		for x := 0; x < w; x += passo {
			if distanciaDeCor(pixel(x, y), fundo) > limiar {
				achou = true
				break
			}
		}
		if achou {
			if y < topo {
				topo = y
			}
			base = y
		}
	}
	if base < 0 {
		return nil, errors.New("a imagem não tem conteúdo")
	}
	folga := h / 40
	topo -= folga
	base += folga
	if topo < 0 {
		topo = 0
	}
	if base > h-1 {
		base = h - 1
	}
	altura := base - topo + 1
	if altura < h/3 {
		return nil, errors.New("conteúdo da ilustração pequeno demais")
	}
	margemX := larguraQuadro / 40

	saida := make([][]byte, 0, n)
	for i := 0; i < n; i++ {
		x0 := i*larguraQuadro + margemX
		x1 := (i+1)*larguraQuadro - margemX
		ret := image.Rect(b.Min.X+x0, b.Min.Y+topo, b.Min.X+x1, b.Min.Y+topo+altura)
		dst := image.NewRGBA(image.Rect(0, 0, ret.Dx(), ret.Dy()))
		draw.Draw(dst, dst.Bounds(), img, ret.Min, draw.Src)
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 82}); err != nil {
			return nil, err
		}
		saida = append(saida, buf.Bytes())
	}
	return saida, nil
}
