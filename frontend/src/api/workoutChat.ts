import { apiClient } from './client';
import type { WorkoutChatMessage, WorkoutChatSubstitution } from '../types';

export interface WorkoutChatSendResult {
  message: WorkoutChatMessage;
  /** Presente só quando a resposta trouxe uma proposta de troca de exercício. */
  substitution?: WorkoutChatSubstitution;
}

export const workoutChatApi = {
  history: async (workoutId: number): Promise<WorkoutChatMessage[]> => {
    const { data } = await apiClient.get<WorkoutChatMessage[] | null>(`/workouts/${workoutId}/chat`);
    // Go handlers often serialize an empty slice as null — normalize it here.
    return data ?? [];
  },
  send: async (workoutId: number, message: string): Promise<WorkoutChatSendResult> => {
    // The endpoint echoes the stored question as `user_message` and the reply as
    // `message`; callers only need the reply, since they render the question
    // optimistically. `substitution` rides along the same response instead of
    // a second call — it is only ever meaningful attached to this exact turn.
    const { data } = await apiClient.post<{
      user_message: WorkoutChatMessage;
      message: WorkoutChatMessage;
      substitution?: WorkoutChatSubstitution;
    }>(
      `/workouts/${workoutId}/chat`,
      { message },
      // The assistant call is slower than a regular CRUD request.
      { timeout: 60000 }
    );
    return { message: data.message, substitution: data.substitution };
  },
};
