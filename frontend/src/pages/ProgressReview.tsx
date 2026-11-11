import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ErrorState, Icon, Notice, SectionTitle, Skeleton, stagger } from '../components/perfil/ui';
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

const GOAL_STATUS: Record<ProgressReview['goal_status'], { label: string; text: string; tone: 'ok' | 'sun' | 'danger' }> = {
  on_track: { label: 'No caminho', text: 'text-ok', tone: 'ok' },
  needs_change: { label: 'Precisa de ajuste', text: 'text-sun', tone: 'sun' },
  at_risk: { label: 'Em risco', text: 'text-danger', tone: 'danger' },
};

const formatDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');

const LINE_STYLE: Record<DiffLine['kind'], string> = {
  added: 'text-ok',
  removed: 'text-danger',
  changed: 'text-sun',
};

const LINE_MARK: Record<DiffLine['kind'], string> = { added: '+', removed: '−', changed: '~' };

function DiffList({ lines }: { lines: DiffLine[] }) {
  if (lines.length === 0) {
    return <p className="mt-3 text-[13px] text-muted">O assistente reescreveu o plano sem alterar nada estrutural.</p>;
  }
  return (
    <ul className="mt-3 space-y-1.5">
      {lines.map((line, index) => (
        <li key={index} className={`flex gap-2 text-[15px] leading-[1.45] ${LINE_STYLE[line.kind]}`}>
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
    <Card tint={selected ? 'violet' : undefined}>
      <label className="flex min-h-[48px] items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={onToggle}
          className="mt-0.5 h-6 w-6 shrink-0 accent-violet"
        />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-[1.3] text-fg">{title}</p>
          <p className="mt-1 text-[15px] leading-[1.45] text-muted">{summary}</p>
        </div>
      </label>
      <button
        type="button"
        onClick={() => setShowDetail((value) => !value)}
        className="press -mb-2 mt-1 min-h-[48px] text-[15px] font-semibold text-violet"
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

  const status = review ? GOAL_STATUS[review.goal_status] : null;
  const retry = () => {
    setError(null);
    setIsLoading(true);
    progressReviewsApi
      .latest()
      .then((latest) => {
        setReview(latest);
        if (latest?.status === 'pending') startPolling(latest.id);
      })
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  };

  return (
    <>
      <Header title="Avaliação" showBack />
      <div className="space-y-[14px] px-5 pb-24 pt-2">
        {isLoading && (
          <div className="space-y-[14px]" aria-busy="true" aria-label="Carregando">
            <Skeleton className="h-[200px]" />
            <Skeleton className="h-[120px]" />
          </div>
        )}

        {error && !isLoading && !review && <ErrorState message={error} onRetry={retry} />}
        {error && review && <Notice tone="danger">{error}</Notice>}

        {!isLoading && !review && !error && (
          <Card tint="violet" className="enter py-8 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-violet-soft text-violet">
              <Icon name="compass" className="h-8 w-8" />
            </span>
            <h2 className="num mt-5 text-[28px] leading-[1.05] text-fg">Avaliar o resultado</h2>
            <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-[1.45] text-muted">
              O assistente lê o que você registrou desde o início do plano: treinos, cargas, alimentação e
              medidas. Compara com o seu objetivo e, se fizer sentido, propõe mudanças que você decide aplicar.
            </p>
            <Button fullWidth size="lg" className="mt-6" isLoading={isStarting} onClick={start}>
              Avaliar meu resultado
            </Button>
          </Card>
        )}

        {review?.status === 'pending' && (
          <Card tint="violet" className="enter">
            <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-violet">Em análise</p>
            <h2 className="num mt-1 text-[28px] leading-[1.05] text-fg">Lendo o seu período</h2>
            <p className="mt-2 text-[15px] leading-[1.45] text-muted">
              Treinos, alimentação e medidas de {formatDate(review.period_start)} até {formatDate(review.period_end)}.
              Leva alguns minutos e você pode sair da tela e voltar depois.
            </p>
            <div className="mt-5 space-y-2.5" aria-hidden="true">
              <Skeleton className="h-3 w-full !rounded-chip" />
              <Skeleton className="h-3 w-5/6 !rounded-chip" />
              <Skeleton className="h-3 w-2/3 !rounded-chip" />
            </div>
          </Card>
        )}

        {review?.status === 'failed' && (
          <Card className="enter">
            <h2 className="text-[17px] font-bold text-fg">Não foi possível avaliar</h2>
            <p className="mt-1 text-[15px] leading-[1.45] text-muted">{review.error || 'O assistente não respondeu.'}</p>
            <Button fullWidth className="mt-4" isLoading={isStarting} onClick={start}>Tentar de novo</Button>
          </Card>
        )}

        {review && status && review.status !== 'pending' && review.status !== 'failed' && (
          <>
            <Card tint="violet" className="enter !p-5">
              <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
                {formatDate(review.period_start)} a {formatDate(review.period_end)}
              </p>
              <h2 className={`num mt-1 text-[40px] leading-[1.02] ${status.text}`}>{status.label}</h2>
              <p className="mt-3 whitespace-pre-line text-base leading-[1.5] text-fg">{review.goal_assessment}</p>
            </Card>

            <section className="enter" style={stagger(1)}>
              <SectionTitle>Desempenho</SectionTitle>
              <Card>
                <p className="whitespace-pre-line text-base leading-[1.5] text-fg">{review.performance}</p>
              </Card>
            </section>

            {hasProposal && (
              <section className="enter space-y-3 pt-2" style={stagger(2)}>
                <div>
                  <SectionTitle>Alterações sugeridas</SectionTitle>
                  <p className="-mt-1 px-1 text-[15px] leading-[1.45] text-muted">
                    Nada muda até você confirmar. O que já foi treinado e registrado continua no histórico, e a
                    versão anterior do plano fica guardada.
                  </p>
                </div>

                {trainingIsReal && trainingChange && (
                  <ChangeCard
                    title={`Treino: ${trainingChange.plan_name}`}
                    summary={trainingChange.summary}
                    lines={trainingLines}
                    selected={applyTraining}
                    disabled={isApplying}
                    onToggle={() => setApplyTraining((value) => !value)}
                  />
                )}

                {nutritionIsReal && nutritionChange && (
                  <ChangeCard
                    title={`Nutrição: ${nutritionChange.plan_name}`}
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
                  <Button variant="ghost" fullWidth disabled={isApplying} onClick={discard}>
                    Manter os planos como estão
                  </Button>
                </div>
              </section>
            )}

            {/*
              Só se afirma que está tudo bem quando o próprio veredito diz isso.
              Antes esta era a única mensagem possível na ausência de proposta, e
              ela aparecia embaixo de um "Precisa de ajuste", dizendo à pessoa
              que os planos estavam adequados logo depois de explicar por que não
              estavam.
            */}
            {advice.length > 0 && (
              <section className="enter pt-2" style={stagger(2)}>
                <SectionTitle>Recomendações</SectionTitle>
                <Card>
                  <p className="text-[13px] text-muted">
                    Orientação para seguir o plano que você já tem. Não há alteração a confirmar aqui.
                  </p>
                  <ul className="mt-3 space-y-3">
                    {advice.map((text) => (
                      <li key={text} className="flex gap-3 text-[15px] leading-[1.45] text-fg">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-chip bg-violet" aria-hidden="true" />
                        <span>{text}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            )}

            {review.status === 'ready' && !hasProposal && advice.length === 0 && !proposalError
              && review.goal_status === 'on_track' && (
              <Notice tone="ok">
                Nenhuma alteração proposta: o assistente considerou que os planos atuais continuam adequados ao
                seu objetivo.
              </Notice>
            )}

            {review.status === 'ready' && !hasProposal && proposalError && (
              <Card>
                <h2 className="text-[17px] font-bold text-sun">A alteração não ficou pronta</h2>
                <p className="mt-1 text-[15px] leading-[1.45] text-muted">{proposalError}</p>
                <p className="mt-2 text-[13px] leading-[1.4] text-muted">
                  Seus planos continuam como estavam. Vale refazer a avaliação ou perguntar abaixo o que
                  mudar, e aplicar você mesmo pelo ajuste do plano.
                </p>
                <Button fullWidth className="mt-4" isLoading={isStarting} onClick={start}>Avaliar de novo</Button>
              </Card>
            )}

            {review.status === 'applied' && (
              <div className="flex items-center gap-3 rounded-lg bg-ok-soft p-[18px]">
                <Chip tone="ok" className="shrink-0">Aplicado</Chip>
                <p className="text-[15px] leading-[1.45] text-fg">
                  Planos atualizados{review.applied_training && review.applied_nutrition
                    ? ' (treino e nutrição)'
                    : review.applied_training
                      ? ' (treino)'
                      : ' (nutrição)'}. O histórico continua intacto.
                </p>
              </div>
            )}

            {review.status === 'discarded' && (
              <Notice tone="violet">Você optou por manter os planos como estavam.</Notice>
            )}

            <ProgressReviewChat reviewId={review.id} />

            <Button fullWidth variant="secondary" isLoading={isStarting} onClick={start}>
              Fazer uma nova avaliação
            </Button>
          </>
        )}
      </div>
    </>
  );
}
