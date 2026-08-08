import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { progressReviewsApi } from '../api/progressReviews';
import { ProgressReviewChat } from '../components/ProgressReviewChat';
import { getErrorMessage } from '../api/client';
import { nutritionDiffLines, trainingDiffLines, type DiffLine } from '../lib/planDiff';
import type { ProgressReview } from '../types';

// A análise é uma chamada ao assistente mais, quando há mudança a propor, uma
// reescrita de plano por plano — a mesma ordem de grandeza da geração
// automática de um plano, três vezes.
const POLL_MS = 4000;
const DEADLINE_MS = 9 * 60 * 1000;

const GOAL_STATUS: Record<ProgressReview['goal_status'], { label: string; badge: string; card: string }> = {
  on_track: { label: 'No caminho', badge: 'bg-emerald-950 text-emerald-300', card: 'border-emerald-900' },
  needs_change: { label: 'Precisa de ajuste', badge: 'bg-amber-950 text-amber-300', card: 'border-amber-900' },
  at_risk: { label: 'Em risco', badge: 'bg-red-950 text-red-300', card: 'border-red-900' },
};

const formatDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');

const LINE_STYLE: Record<DiffLine['kind'], string> = {
  added: 'text-emerald-400',
  removed: 'text-red-400',
  changed: 'text-amber-300',
};

const LINE_MARK: Record<DiffLine['kind'], string> = { added: '+', removed: '−', changed: '~' };

function DiffList({ lines }: { lines: DiffLine[] }) {
  if (lines.length === 0) {
    return <p className="mt-2 text-xs text-zinc-600">O assistente reescreveu o plano sem alterar nada estrutural.</p>;
  }
  return (
    <ul className="mt-2 space-y-1">
      {lines.map((line, index) => (
        <li key={index} className={`flex gap-2 text-xs leading-relaxed ${LINE_STYLE[line.kind]}`}>
          <span className="font-bold">{LINE_MARK[line.kind]}</span>
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Um bloco de proposta: o resumo, o detalhe do que muda e a caixa de seleção. */
function ChangeCard({
  title,
  summary,
  lines,
  selected,
  disabled,
  onToggle,
}: {
  title: string;
  summary: string;
  lines: DiffLine[];
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <Card className={selected ? 'border-primary-800 bg-primary-950/20' : ''}>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={onToggle}
          className="mt-1 h-5 w-5 shrink-0 accent-primary-600"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">{summary}</p>
        </div>
      </label>
      <button
        type="button"
        onClick={() => setShowDetail((value) => !value)}
        className="mt-3 text-xs font-medium text-primary-400"
      >
        {showDetail ? 'Ocultar o que muda' : `Ver o que muda (${lines.length})`}
      </button>
      {showDetail && <DiffList lines={lines} />}
    </Card>
  );
}

export function ProgressReviewPage() {
  const [review, setReview] = useState<ProgressReview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyTraining, setApplyTraining] = useState(true);
  const [applyNutrition, setApplyNutrition] = useState(true);

  // O polling roda fora do React: um intervalo guardado em ref é o que
  // sobrevive a re-render sem duplicar, e é o que dá para limpar no unmount
  // quando a pessoa sai da tela no meio da análise.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const startPolling = useCallback((id: number) => {
    stopPolling();
    const deadline = Date.now() + DEADLINE_MS;
    pollTimer.current = setInterval(async () => {
      if (Date.now() > deadline) {
        stopPolling();
        setError('A avaliação está demorando mais que o esperado. Tente de novo em instantes.');
        return;
      }
      try {
        const updated = await progressReviewsApi.get(id);
        setReview(updated);
        if (updated.status !== 'pending') stopPolling();
      } catch {
        // Uma falha isolada de rede não encerra a análise, que roda no
        // servidor: a próxima batida do intervalo tenta de novo.
      }
    }, POLL_MS);
  }, [stopPolling]);

  useEffect(() => {
    progressReviewsApi
      .latest()
      .then((latest) => {
        setReview(latest);
        if (latest?.status === 'pending') startPolling(latest.id);
      })
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
    return stopPolling;
  }, [startPolling, stopPolling]);

  const start = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const created = await progressReviewsApi.create();
      setReview(created);
      setApplyTraining(true);
      setApplyNutrition(true);
      if (created.status === 'pending') startPolling(created.id);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsStarting(false);
    }
  };

  const apply = async () => {
    if (!review) return;
    setIsApplying(true);
    setError(null);
    try {
      setReview(await progressReviewsApi.apply(review.id, {
        apply_training: applyTraining && trainingIsReal,
        apply_nutrition: applyNutrition && nutritionIsReal,
      }));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsApplying(false);
    }
  };

  const discard = async () => {
    if (!review) return;
    setIsApplying(true);
    setError(null);
    try {
      setReview(await progressReviewsApi.discard(review.id));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsApplying(false);
    }
  };

  const trainingChange = review?.training_change;
  const nutritionChange = review?.nutrition_change;

  // O assistente às vezes devolve o plano reescrito idêntico e usa o resumo para
  // dar um conselho ("mantenha as metas e registre todo dia"). Isso é orientação,
  // não alteração: oferecer "confirmar e atualizar" para um plano que não muda
  // faria a pessoa aprovar um nada e achar que resolveu alguma coisa.
  const trainingLines = useMemo(
    () => (trainingChange ? trainingDiffLines(trainingChange.current_plan, trainingChange.plan) : []),
    [trainingChange],
  );
  const nutritionLines = useMemo(
    () => (nutritionChange ? nutritionDiffLines(nutritionChange.current_plan, nutritionChange.plan) : []),
    [nutritionChange],
  );
  const trainingIsReal = !!trainingChange && trainingLines.length > 0;
  const nutritionIsReal = !!nutritionChange && nutritionLines.length > 0;
  const advice = [
    trainingChange && !trainingIsReal ? trainingChange.summary : '',
    nutritionChange && !nutritionIsReal ? nutritionChange.summary : '',
  ].filter(Boolean);

  const hasProposal = review?.status === 'ready' && (trainingIsReal || nutritionIsReal);
  const nothingSelected = !(applyTraining && trainingIsReal) && !(applyNutrition && nutritionIsReal);
  const proposalError = [review?.training_proposal_error, review?.nutrition_proposal_error]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <Header title="Avaliação" showBack />
      <div className="space-y-4 px-4 py-5 pb-24">
        {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

        {isLoading && <div className="py-20 text-center text-zinc-500">Carregando...</div>}

        {!isLoading && !review && (
          <Card className="text-center">
            <p className="text-4xl">🧭</p>
            <h2 className="mt-3 font-bold text-white">Avaliar o resultado</h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              O assistente lê tudo o que você registrou desde o início do plano — treinos executados, cargas,
              alimentação e medições — e compara com o seu objetivo. Se fizer sentido mudar o treino ou a
              nutrição, ele propõe a mudança e você decide se aplica.
            </p>
            <Button fullWidth size="lg" className="mt-4" isLoading={isStarting} onClick={start}>
              Avaliar meu resultado
            </Button>
          </Card>
        )}

        {review?.status === 'pending' && (
          <Card className="text-center">
            <p className="animate-pulse text-4xl">🧭</p>
            <h2 className="mt-3 font-bold text-white">Analisando o período</h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              Lendo treinos, alimentação e medições de {formatDate(review.period_start)} até{' '}
              {formatDate(review.period_end)}. Isso leva alguns minutos — pode sair da tela e voltar depois.
            </p>
          </Card>
        )}

        {review?.status === 'failed' && (
          <Card>
            <h2 className="font-bold text-white">Não foi possível avaliar</h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{review.error || 'O assistente não respondeu.'}</p>
            <Button fullWidth className="mt-4" isLoading={isStarting} onClick={start}>Tentar de novo</Button>
          </Card>
        )}

        {review && review.status !== 'pending' && review.status !== 'failed' && (
          <>
            <p className="px-1 text-xs text-zinc-600">
              Período de {formatDate(review.period_start)} a {formatDate(review.period_end)}
            </p>

            <Card>
              <h2 className="text-xs uppercase tracking-wide text-zinc-500">Desempenho</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-200">{review.performance}</p>
            </Card>

            <Card className={GOAL_STATUS[review.goal_status].card}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xs uppercase tracking-wide text-zinc-500">Objetivo</h2>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${GOAL_STATUS[review.goal_status].badge}`}>
                  {GOAL_STATUS[review.goal_status].label}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-200">{review.goal_assessment}</p>
            </Card>

            {hasProposal && (
              <div className="space-y-3">
                <div className="px-1">
                  <h2 className="text-xs uppercase tracking-wide text-zinc-500">Alterações sugeridas</h2>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                    Nada muda até você confirmar. O que já foi treinado e registrado continua no histórico, e a
                    versão anterior do plano fica guardada.
                  </p>
                </div>

                {trainingIsReal && trainingChange && (
                  <ChangeCard
                    title={`Treino — ${trainingChange.plan_name}`}
                    summary={trainingChange.summary}
                    lines={trainingLines}
                    selected={applyTraining}
                    disabled={isApplying}
                    onToggle={() => setApplyTraining((value) => !value)}
                  />
                )}

                {nutritionIsReal && nutritionChange && (
                  <ChangeCard
                    title={`Nutrição — ${nutritionChange.plan_name}`}
                    summary={nutritionChange.summary}
                    lines={nutritionLines}
                    selected={applyNutrition}
                    disabled={isApplying}
                    onToggle={() => setApplyNutrition((value) => !value)}
                  />
                )}

                <div className="space-y-2 pt-1">
                  <Button fullWidth size="lg" isLoading={isApplying} disabled={nothingSelected} onClick={apply}>
                    Confirmar e atualizar os planos
                  </Button>
                  <button
                    type="button"
                    disabled={isApplying}
                    onClick={discard}
                    className="w-full py-3 text-sm text-zinc-500 disabled:opacity-50"
                  >
                    Manter os planos como estão
                  </button>
                </div>
              </div>
            )}

            {/*
              Só se afirma que está tudo bem quando o próprio veredito diz isso.
              Antes esta era a única mensagem possível na ausência de proposta, e
              ela aparecia embaixo de um "Precisa de ajuste" — dizendo à pessoa
              que os planos estavam adequados logo depois de explicar por que não
              estavam.
            */}
            {advice.length > 0 && (
              <Card>
                <h2 className="text-xs uppercase tracking-wide text-zinc-500">Recomendações</h2>
                <p className="mt-1 text-xs text-zinc-600">
                  Orientação para seguir o plano que você já tem — não há alteração a confirmar aqui.
                </p>
                <ul className="mt-2 space-y-2">
                  {advice.map((text) => (
                    <li key={text} className="flex gap-2 text-sm leading-relaxed text-zinc-300">
                      <span className="text-primary-500">•</span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {review.status === 'ready' && !hasProposal && advice.length === 0 && !proposalError
              && review.goal_status === 'on_track' && (
              <Card className="border-emerald-900">
                <p className="text-sm leading-relaxed text-zinc-300">
                  Nenhuma alteração proposta: o assistente considerou que os planos atuais continuam adequados ao
                  seu objetivo.
                </p>
              </Card>
            )}

            {review.status === 'ready' && !hasProposal && proposalError && (
              <Card className="border-amber-900 bg-amber-950/20">
                <h2 className="text-sm font-bold text-amber-300">A alteração não ficou pronta</h2>
                <p className="mt-1 text-sm leading-relaxed text-zinc-300">{proposalError}</p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                  Seus planos continuam como estavam. Vale refazer a avaliação — ou perguntar abaixo o que
                  mudar, e aplicar você mesmo pelo ajuste do plano.
                </p>
                <Button fullWidth className="mt-3" isLoading={isStarting} onClick={start}>Avaliar de novo</Button>
              </Card>
            )}

            {review.status === 'applied' && (
              <Card className="border-emerald-900 bg-emerald-950/20">
                <p className="text-sm leading-relaxed text-emerald-300">
                  Planos atualizados{review.applied_training && review.applied_nutrition
                    ? ' (treino e nutrição)'
                    : review.applied_training
                      ? ' (treino)'
                      : ' (nutrição)'}. O histórico de treinos e de alimentação continua intacto.
                </p>
              </Card>
            )}

            {review.status === 'discarded' && (
              <Card>
                <p className="text-sm leading-relaxed text-zinc-400">
                  Você optou por manter os planos como estavam.
                </p>
              </Card>
            )}

            <ProgressReviewChat reviewId={review.id} />

            <Button fullWidth variant="secondary" isLoading={isStarting} onClick={start} className="mt-2">
              Fazer uma nova avaliação
            </Button>
          </>
        )}
      </div>
    </>
  );
}
