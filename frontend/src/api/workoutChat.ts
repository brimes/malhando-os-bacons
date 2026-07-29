import { apiClient } from './client';
import type { WorkoutChatMessage } from '../types';

export const workoutChatApi = {
  history: async (workoutId: number): Promise<WorkoutChatMessage[]> => {
    const { data } = await apiClient.get<WorkoutChatMessage[] | null>(`/workouts/${workoutId}/chat`);
    // Go handlers often serialize an empty slice as null — normalize it here.
    return data ?? [];
  },
  send: async (workoutId: number, message: string): Promise<WorkoutChatMessage> => {
    // The endpoint echoes the stored question as `user_message` and the reply as
    // `message`; callers only need the reply, since they render the question
    // optimistically.
    const { data } = await apiClient.post<{ user_message: WorkoutChatMessage; message: WorkoutChatMessage }>(
      `/workouts/${workoutId}/chat`,
      { message },
      // The assistant call is slower than a regular CRUD request.
      { timeout: 60000 }
    );
    return data.message;
  },
};
