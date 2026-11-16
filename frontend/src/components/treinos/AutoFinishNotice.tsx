import { useNavigate } from 'react-router-dom';
import { Button } from '../Button';
import { Sheet } from './Sheet';
import type { AutoFinishNotice as Notice } from '../../lib/autoFinish';

/** "Seu treino foi finalizado automaticamente" — mostrado uma vez só. */
export function AutoFinishNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const navigate = useNavigate();
  const open = () => {
    onClose();
    // Treino ainda só local (id negativo) não tem detalhe no servidor: vai para o histórico.
    navigate(notice.workoutId > 0 ? `/workouts/${notice.workoutId}` : '/workouts/history');
  };
  return (
    <Sheet onClose={onClose} label="Treino finalizado automaticamente">
      <h2 className="text-[20px] font-bold leading-[1.3] text-fg">Seu treino foi finalizado automaticamente</h2>
      <p className="mt-2 text-[15px] leading-[1.5] text-muted">
        Parece que você esqueceu de finalizar. Marcamos as séries restantes como concluídas. Para ver ou ajustar, vá ao histórico de treinos.
      </p>
      <div className="mt-5 space-y-3">
        <Button fullWidth size="lg" onClick={open}>Ver treino</Button>
        <Button fullWidth size="lg" variant="secondary" onClick={onClose}>Fechar</Button>
      </div>
    </Sheet>
  );
}
