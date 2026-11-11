package services

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png" // registra o decoder: o Gemini devolve PNG
	"strings"

	_ "golang.org/x/image/webp" // registra o decoder: o modelo pode devolver WebP
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
- frames: how many key frames (2 to 4) are the minimum that make the movement clear. Use 3 (start, middle, end) whenever the movement has an intermediate phase, which is almost always; 4 only for multi-phase movements; 2 ONLY for isometric holds or movements with no meaningful middle position.
- frame_descriptions: exactly "frames" strings, in order, each describing the pose and equipment state of that frame in one sentence.

- Isometric holds (plank, wall sit, dead hang): the exercise has no repetition. Describe the correct final hold ONLY, and make every frame show that same hold (at most a tiny difference such as breathing). Never show a regression or a preparation such as kneeling, resting on the knees or lowering to the floor.
- Machines with moving levers or pads: the seat, backrest, frame and handles are identical in every frame; only the levers and the body move, and the body's contact points with the pads (e.g. inner knees, outer knees, forearms) stay the same in every frame.
- Frame descriptions must be visibly different poses (the two extremes of the movement), not two near-identical positions. State the visible difference explicitly and concretely, in terms of the silhouette an illustrator draws (for example "feet and knees clearly wider than the shoulders, thighs forming a wide V, pads far apart" versus "feet, knees and thighs touching, pads together"). For a hold, only the first frame may differ slightly in the arms or hips; never change the facing direction.

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
	fmt.Fprintf(&b, "Each panel is centered in its own half or third of the image. All panels have EQUAL width, separated by an equal empty gap, with no borders, frames, lines or dividers. ")
	fmt.Fprintf(&b, "Every panel shows the SAME single person (same face, hair, body, outfit), the SAME equipment (identical seat, frame, handles and colours; only moving levers or the barbell change position) in the same place, the same camera distance and framing, and the same plain light solid background; only the pose changes between panels. The person faces the SAME direction in every panel (never mirrored). The panels must be clearly distinguishable: never repeat the same pose, except for an isometric hold, where all panels show the same hold. Exactly one person per panel, full body and the full equipment visible, nothing cropped. ")
	fmt.Fprintf(&b, "Camera: %s.\n", nomesDeVista[d.CameraView])
	fmt.Fprintf(&b, "Equipment (must be exactly this, no other machine): %s.\n", d.Equipment)
	fmt.Fprintf(&b, "Moving joint: %s.\n", d.MovingJoint)
	for i, q := range d.FrameDescriptions {
		pos := fmt.Sprintf("position %d from the left", i+1)
		fmt.Fprintf(&b, "Panel %d of %d (%s): %s\n", i+1, d.Frames, pos, q)
	}
	b.WriteString("Style: clean, professional gym-manual illustration with a consistent line weight, realistic anatomical proportions, a simple face with basic features (eyes, nose, mouth), sober muted colours, and a plain solid white background. The equipment must look faithful to the real machine or barbell as found in a gym. Anatomically correct posture. Absolutely no text, no letters, no numbers, no arrows, no captions, no labels, no watermarks anywhere in the image.")
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
		return nil, fmt.Errorf("imagem ilegível (%d bytes, tipo %s): %w", len(data), tipoDaImagem(data), err)
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
	// Mapa de conteúdo: ocupação por linha e por coluna.
	const limiar = 60
	passo := 2
	linhas := make([]bool, h)
	colunas := make([]bool, w)
	for y := 0; y < h; y += passo {
		for x := 0; x < w; x += passo {
			if distanciaDeCor(pixel(x, y), fundo) > limiar {
				linhas[y] = true
				colunas[x] = true
			}
		}
	}
	topo, base := -1, -1
	for y, ocupada := range linhas {
		if ocupada {
			if topo < 0 {
				topo = y
			}
			base = y
		}
	}
	if base < 0 {
		return nil, errors.New("a imagem não tem conteúdo")
	}
	folga := h / 40
	topo = max(topo-folga, 0)
	base = min(base+folga, h-1)
	altura := base - topo + 1
	if altura < h/8 {
		return nil, errors.New("conteúdo da ilustração pequeno demais")
	}

	// Colunas: o modelo não divide a tira em partes exatamente iguais, então
	// cada quadro é a nuvem de conteúdo que o painel formou. Sem n nuvens
	// distintas, cai na divisão em partes iguais.
	faixas := faixasDeConteudo(colunas, n)
	if faixas == nil {
		faixas = make([][2]int, n)
		for i := range faixas {
			faixas[i] = [2]int{i*larguraQuadro + larguraQuadro/6, (i+1)*larguraQuadro - larguraQuadro/6 - 1}
		}
	}
	// Todos os quadros com o mesmo tamanho (a animação não pode pular), cada
	// conteúdo centralizado no seu; o que sai da imagem fica com a cor do fundo.
	maior := 0
	for _, f := range faixas {
		maior = max(maior, f[1]-f[0]+1)
	}
	margemX := maior / 12
	largura := maior + 2*margemX
	if largura > larguraQuadro*3/2 {
		return nil, errors.New("conteúdo dos quadros se sobrepõe")
	}
	corFundo := color.RGBA{uint8(fundo[0]), uint8(fundo[1]), uint8(fundo[2]), 255}

	// Posição horizontal de cada quadro. Centralizar cada nuvem desalinha o
	// aparelho quando o corpo se estende para um lado (perna esticada), e a
	// animação faria a máquina pular. Parte-se do centro e refina-se o
	// deslocamento para que as partes fixas (aparelho, fundo) coincidam com o
	// primeiro quadro; o corpo, que é o que se move, fica de fora do alinhamento
	// por ser minoria dos pixels.
	cinza := func(x, y int) int {
		if x < 0 || x >= w {
			return (fundo[0] + fundo[1] + fundo[2]) / 3
		}
		p := pixel(x, y)
		return (p[0] + p[1] + p[2]) / 3
	}
	inicios := make([]int, len(faixas))
	for i, f := range faixas {
		inicios[i] = (f[0]+f[1])/2 - largura/2
	}
	for i := 1; i < len(inicios); i++ {
		melhor, custoMin := inicios[i], -1
		for dx := -largura / 4; dx <= largura/4; dx += 2 {
			custo := 0
			for y := topo; y <= base; y += 6 {
				for x := 0; x < largura; x += 6 {
					d := cinza(inicios[0]+x, y) - cinza(inicios[i]+dx+x, y)
					if d < 0 {
						d = -d
					}
					// diferença limitada: o corpo em movimento não pesa mais que o aparelho
					custo += min(d, 40)
				}
			}
			if custoMin < 0 || custo < custoMin {
				melhor, custoMin = inicios[i]+dx, custo
			}
		}
		inicios[i] = melhor
	}

	// Janela final: a união do conteúdo de todos os quadros, já alinhados (a
	// perna esticada de um não pode ser cortada só porque o outro é mais estreito).
	umin, umax := 1<<30, -1<<30
	for i, f := range faixas {
		deslocamento := inicios[i] - inicios[0]
		umin = min(umin, f[0]-deslocamento)
		umax = max(umax, f[1]-deslocamento)
	}
	margemX = (umax - umin) / 12
	largura = umax - umin + 1 + 2*margemX
	if largura > larguraQuadro*2 {
		return nil, errors.New("conteúdo dos quadros se sobrepõe")
	}
	base0 := umin - margemX
	saida := make([][]byte, 0, n)
	for i := range inicios {
		x0 := base0 + inicios[i] - inicios[0]
		dst := image.NewRGBA(image.Rect(0, 0, largura, altura))
		draw.Draw(dst, dst.Bounds(), &image.Uniform{corFundo}, image.Point{}, draw.Src)
		draw.Draw(dst, dst.Bounds(), img, image.Pt(b.Min.X+x0, b.Min.Y+topo), draw.Src)
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 82}); err != nil {
			return nil, err
		}
		saida = append(saida, buf.Bytes())
	}
	return saida, nil
}

// faixasDeConteudo agrupa as colunas ocupadas em exatamente n faixas
// [inicio, fim], unindo sempre as vizinhas separadas pelo menor vão. Devolve
// nil quando há menos de n grupos.
func faixasDeConteudo(colunas []bool, n int) [][2]int {
	var faixas [][2]int
	inicio := -1
	for x, ocupada := range colunas {
		switch {
		case ocupada && inicio < 0:
			inicio = x
		case !ocupada && inicio >= 0:
			faixas = append(faixas, [2]int{inicio, x - 1})
			inicio = -1
		}
	}
	if inicio >= 0 {
		faixas = append(faixas, [2]int{inicio, len(colunas) - 1})
	}
	// Ruído de poucos pixels não é um quadro.
	minimo := len(colunas) / 100
	filtradas := faixas[:0]
	for _, f := range faixas {
		if f[1]-f[0]+1 >= minimo {
			filtradas = append(filtradas, f)
		}
	}
	faixas = filtradas
	for len(faixas) > n {
		melhor, vao := 0, 1<<30
		for i := 0; i+1 < len(faixas); i++ {
			if v := faixas[i+1][0] - faixas[i][1]; v < vao {
				melhor, vao = i, v
			}
		}
		faixas[melhor][1] = faixas[melhor+1][1]
		faixas = append(faixas[:melhor+1], faixas[melhor+2:]...)
	}
	if len(faixas) < n {
		return nil
	}
	return faixas
}

// tipoDaImagem identifica o formato pelos primeiros bytes, só para o log de
// erro (o mimeType declarado pelo provedor não é confiável).
func tipoDaImagem(d []byte) string {
	switch {
	case bytes.HasPrefix(d, []byte("\x89PNG\r\n\x1a\n")):
		return "png"
	case bytes.HasPrefix(d, []byte("\xff\xd8\xff")):
		return "jpeg"
	case len(d) >= 12 && string(d[:4]) == "RIFF" && string(d[8:12]) == "WEBP":
		return "webp"
	}
	return "desconhecido"
}
