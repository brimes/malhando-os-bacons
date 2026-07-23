package com.mob.watch

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * Reads health data from Samsung Galaxy Watch 7 sensors.
 * Uses Android's SensorManager for step counter.
 * For heart rate and advanced health metrics, Samsung Health SDK would be used.
 */
class HealthDataCollector(private val context: Context) {

    companion object {
        private const val TAG = "HealthDataCollector"
        private val DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    }

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    private val _stepCount = MutableStateFlow(0)
    val stepCount = _stepCount.asStateFlow()

    private val _heartRate = MutableStateFlow(0f)
    val heartRate = _heartRate.asStateFlow()

    /**
     * Observe step counter as a Flow.
     * The step counter sensor returns cumulative steps since last reboot.
     */
    fun observeSteps(): Flow<Int> = callbackFlow {
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        if (sensor == null) {
            Log.w(TAG, "Step counter sensor not available")
            trySend(0)
            close()
            return@callbackFlow
        }

        var initialSteps = -1
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                val totalSteps = event.values[0].toInt()
                if (initialSteps < 0) initialSteps = totalSteps
                val todaySteps = totalSteps - initialSteps
                _stepCount.value = todaySteps
                trySend(todaySteps)
            }

            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
        }

        sensorManager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)

        awaitClose {
            sensorManager.unregisterListener(listener)
        }
    }

    /**
     * Observe heart rate as a Flow.
     */
    fun observeHeartRate(): Flow<Float> = callbackFlow {
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_HEART_RATE)
        if (sensor == null) {
            Log.w(TAG, "Heart rate sensor not available")
            close()
            return@callbackFlow
        }

        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (event.accuracy >= SensorManager.SENSOR_STATUS_ACCURACY_LOW) {
                    val bpm = event.values[0]
                    _heartRate.value = bpm
                    trySend(bpm)
                }
            }

            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
        }

        sensorManager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)

        awaitClose {
            sensorManager.unregisterListener(listener)
        }
    }

    /**
     * Estimate calories burned from step count.
     * Uses a simplified MET-based formula.
     * @param steps Number of steps taken
     * @param weightKg User's body weight in kg (default 75kg if unknown)
     */
    fun estimateCaloriesFromSteps(steps: Int, weightKg: Float = 75f): Double {
        val stepsPerKm = 1312.0
        val kmWalked = steps / stepsPerKm
        val metValue = 3.5
        val timeHours = kmWalked / 5.0 // assume ~5 km/h walking speed
        return metValue * weightKg * timeHours
    }

    /**
     * Get today's date as a string for the API
     */
    fun todayDate(): String = LocalDate.now().format(DATE_FMT)

    /**
     * Read current step count snapshot (non-reactive)
     */
    suspend fun getCurrentSteps(): Int {
        // Return cached value; updated by observeSteps()
        return _stepCount.value
    }
}
