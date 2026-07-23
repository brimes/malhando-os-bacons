package com.mob.watch

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.*
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * Wear OS activity for quick workout registration from the watch.
 * Allows selecting a preset workout or logging a custom exercise on the go.
 */
class WorkoutActivity : ComponentActivity() {

    private lateinit var apiClient: ApiClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        apiClient = ApiClient(this)

        setContent {
            WorkoutScreen(
                apiClient = apiClient,
                onDone = { finish() },
            )
        }
    }
}

data class QuickExercise(
    val name: String,
    val defaultSets: Int = 3,
    val defaultReps: Int = 10,
    val defaultWeight: Float = 0f,
)

val QUICK_EXERCISES = listOf(
    QuickExercise("Supino", 4, 10, 80f),
    QuickExercise("Agachamento", 4, 8, 100f),
    QuickExercise("Levantamento Terra", 3, 5, 120f),
    QuickExercise("Desenvolvimento", 3, 12, 60f),
    QuickExercise("Remada", 4, 10, 70f),
    QuickExercise("Rosca Direta", 3, 12, 30f),
    QuickExercise("Tríceps Pulley", 3, 15, 25f),
    QuickExercise("Leg Press", 4, 12, 150f),
    QuickExercise("Caminhada", 1, 1, 0f),
    QuickExercise("Corrida", 1, 1, 0f),
)

@Composable
fun WorkoutScreen(
    apiClient: ApiClient,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var selectedExercises by remember { mutableStateOf(setOf<String>()) }
    var isSaving by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val toggle = { name: String ->
        selectedExercises = if (name in selectedExercises) {
            selectedExercises - name
        } else {
            selectedExercises + name
        }
    }

    val saveWorkout = {
        scope.launch {
            isSaving = true
            error = null
            try {
                val exercises = QUICK_EXERCISES.filter { it.name in selectedExercises }
                val sets = exercises.map { e ->
                    mapOf(
                        "exercise_name" to e.name,
                        "sets" to e.defaultSets,
                        "reps" to e.defaultReps,
                        "weight_kg" to e.defaultWeight.toDouble(),
                    )
                }
                val now = LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME)
                val result = apiClient.createWorkout("Treino Watch", now, sets)
                result.onSuccess {
                    saved = true
                }.onFailure { e ->
                    error = e.message ?: "Falha ao salvar"
                }
            } catch (e: Exception) {
                error = e.message
            } finally {
                isSaving = false
            }
        }
        Unit
    }

    MaterialTheme {
        if (saved) {
            // Success screen
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("✅", fontSize = 32.sp)
                    Spacer(Modifier.height(8.dp))
                    Text("Salvo!", color = Color.White, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = onDone, modifier = Modifier.width(80.dp)) {
                        Text("Ok", fontSize = 12.sp)
                    }
                }
            }
            return@MaterialTheme
        }

        ScalingLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
            contentPadding = PaddingValues(top = 24.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item {
                Text(
                    "Selecionar Exercícios",
                    color = Color(0xFFD946EF),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                )
            }

            items(QUICK_EXERCISES.size) { i ->
                val exercise = QUICK_EXERCISES[i]
                val isSelected = exercise.name in selectedExercises
                ToggleChip(
                    checked = isSelected,
                    onCheckedChange = { toggle(exercise.name) },
                    label = {
                        Text(exercise.name, fontSize = 11.sp, color = Color.White)
                    },
                    modifier = Modifier
                        .fillMaxWidth(0.9f)
                        .padding(vertical = 2.dp),
                    toggleControl = {
                        Icon(
                            imageVector = ToggleChipDefaults.checkboxIcon(isSelected),
                            contentDescription = if (isSelected) "Selecionado" else "Não selecionado",
                        )
                    },
                    colors = ToggleChipDefaults.toggleChipColors(
                        checkedStartBackgroundColor = Color(0xFF4A044E),
                        checkedEndBackgroundColor = Color(0xFF701A75),
                        uncheckedStartBackgroundColor = Color(0xFF27272A),
                        uncheckedEndBackgroundColor = Color(0xFF18181B),
                    ),
                )
            }

            if (error != null) {
                item {
                    Text(error!!, color = Color.Red, fontSize = 10.sp)
                }
            }

            item {
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { saveWorkout() },
                    enabled = selectedExercises.isNotEmpty() && !isSaving,
                    modifier = Modifier.fillMaxWidth(0.8f),
                    colors = ButtonDefaults.primaryButtonColors(
                        backgroundColor = Color(0xFFD946EF),
                        disabledBackgroundColor = Color(0xFF52525B),
                    ),
                ) {
                    if (isSaving) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Salvar (${selectedExercises.size})", fontSize = 12.sp)
                    }
                }
            }

            item {
                OutlinedButton(
                    onClick = onDone,
                    modifier = Modifier.fillMaxWidth(0.8f),
                ) {
                    Text("Cancelar", fontSize = 12.sp, color = Color(0xFF71717A))
                }
            }
        }
    }
}
