package com.mob.watch

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.*
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Main Wear OS activity — shows daily metrics (steps, calories, workout status).
 * Displayed on the watch home screen.
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "MOBMainActivity"
    }

    private lateinit var apiClient: ApiClient
    private lateinit var healthCollector: HealthDataCollector

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        apiClient = ApiClient(this)
        healthCollector = HealthDataCollector(this)

        // Start background sync service
        SyncService.start(this)

        setContent {
            WearApp(
                onOpenWorkout = {
                    startActivity(Intent(this, WorkoutActivity::class.java))
                },
                apiClient = apiClient,
                healthCollector = healthCollector,
            )
        }
    }
}

@Composable
fun WearApp(
    onOpenWorkout: () -> Unit,
    apiClient: ApiClient,
    healthCollector: HealthDataCollector,
) {
    val scope = rememberCoroutineScope()
    var steps by remember { mutableIntStateOf(0) }
    var heartRate by remember { mutableFloatStateOf(0f) }
    var calories by remember { mutableDoubleStateOf(0.0) }
    var workoutsThisWeek by remember { mutableIntStateOf(0) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        // Observe steps
        scope.launch {
            healthCollector.observeSteps().collect { count ->
                steps = count
                calories = healthCollector.estimateCaloriesFromSteps(count)
            }
        }

        // Observe heart rate
        scope.launch {
            healthCollector.observeHeartRate().collect { bpm ->
                heartRate = bpm
            }
        }

        // Fetch dashboard data
        scope.launch {
            if (apiClient.isLoggedIn()) {
                val result = apiClient.getDashboard()
                result.onSuccess { json ->
                    val stats = json.optJSONObject("workout_stats")
                    workoutsThisWeek = stats?.optInt("workouts_this_week") ?: 0
                    isLoading = false
                }.onFailure { e ->
                    errorMsg = e.message
                    isLoading = false
                }
            } else {
                errorMsg = "Não autenticado"
                isLoading = false
            }
        }
    }

    MaterialTheme {
        ScalingLazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
            contentPadding = PaddingValues(top = 20.dp, bottom = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item {
                Text(
                    text = "MOB",
                    color = Color(0xFFD946EF),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Black,
                )
            }

            if (isLoading) {
                item {
                    CircularProgressIndicator(
                        modifier = Modifier.size(32.dp),
                        strokeWidth = 2.dp,
                        indicatorColor = Color(0xFFD946EF),
                    )
                }
            } else if (errorMsg != null) {
                item {
                    Text(
                        text = errorMsg ?: "Erro",
                        color = Color.Red,
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            } else {
                // Steps
                item {
                    MetricCard(
                        icon = "👟",
                        label = "Passos",
                        value = steps.toString(),
                    )
                }

                // Calories
                item {
                    MetricCard(
                        icon = "🔥",
                        label = "Kcal gastas",
                        value = "${calories.toInt()}",
                    )
                }

                // Heart rate
                if (heartRate > 0) {
                    item {
                        MetricCard(
                            icon = "❤️",
                            label = "BPM",
                            value = "${heartRate.toInt()}",
                        )
                    }
                }

                // Workouts this week
                item {
                    MetricCard(
                        icon = "💪",
                        label = "Treinos/semana",
                        value = workoutsThisWeek.toString(),
                    )
                }

                // Quick action button
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = onOpenWorkout,
                        modifier = Modifier
                            .fillMaxWidth(0.8f)
                            .height(40.dp),
                        colors = ButtonDefaults.primaryButtonColors(
                            backgroundColor = Color(0xFFD946EF),
                        ),
                    ) {
                        Text("+ Treino", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
fun MetricCard(icon: String, label: String, value: String) {
    Card(
        onClick = {},
        modifier = Modifier
            .fillMaxWidth(0.9f)
            .padding(vertical = 3.dp),
        backgroundPainter = CardDefaults.cardBackgroundPainter(
            startBackgroundColor = Color(0xFF27272A),
            endBackgroundColor = Color(0xFF18181B),
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(icon, fontSize = 16.sp)
                Text(label, color = Color(0xFF71717A), fontSize = 11.sp)
            }
            Text(value, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}
