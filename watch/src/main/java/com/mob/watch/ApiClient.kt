package com.mob.watch

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * HTTP client for communicating with the MOB backend REST API.
 * Token is stored in shared preferences after login on the companion phone app.
 */
class ApiClient(private val context: Context) {

    companion object {
        private const val PREF_NAME = "mob_prefs"
        private const val KEY_TOKEN = "jwt_token"
        private const val KEY_BASE_URL = "base_url"
        private const val DEFAULT_BASE_URL = "https://api.mob.app"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    private val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL

    private val token: String?
        get() = prefs.getString(KEY_TOKEN, null)

    fun saveToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun saveBaseUrl(url: String) {
        prefs.edit().putString(KEY_BASE_URL, url).apply()
    }

    fun isLoggedIn(): Boolean = token != null

    /**
     * POST /api/steps/sync — upload step count from watch to backend
     */
    suspend fun syncSteps(date: String, count: Int, caloriesBurned: Double): Result<JSONObject> =
        withContext(Dispatchers.IO) {
            val body = JSONObject().apply {
                put("date", date)
                put("count", count)
                put("calories_burned", caloriesBurned)
                put("source", "galaxy_watch")
            }
            post("/api/steps/sync", body)
        }

    /**
     * GET /api/dashboard — fetch summary data to display on watch face
     */
    suspend fun getDashboard(): Result<JSONObject> = withContext(Dispatchers.IO) {
        get("/api/dashboard")
    }

    /**
     * POST /api/workouts — quick workout registration from watch
     */
    suspend fun createWorkout(name: String, date: String, sets: List<Map<String, Any>>): Result<JSONObject> =
        withContext(Dispatchers.IO) {
            val setsArray = org.json.JSONArray()
            sets.forEach { s ->
                setsArray.put(JSONObject(s))
            }
            val body = JSONObject().apply {
                put("name", name)
                put("date", date)
                put("sets", setsArray)
            }
            post("/api/workouts", body)
        }

    private fun get(path: String): Result<JSONObject> {
        val t = token ?: return Result.failure(IOException("Not authenticated"))
        return try {
            val request = Request.Builder()
                .url("$baseUrl$path")
                .header("Authorization", "Bearer $t")
                .header("Accept", "application/json")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string() ?: "{}"
                if (response.isSuccessful) {
                    Result.success(JSONObject(bodyStr))
                } else {
                    Result.failure(IOException("HTTP ${response.code}: $bodyStr"))
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun post(path: String, json: JSONObject): Result<JSONObject> {
        val t = token ?: return Result.failure(IOException("Not authenticated"))
        return try {
            val requestBody = json.toString().toRequestBody(JSON_MEDIA_TYPE)
            val request = Request.Builder()
                .url("$baseUrl$path")
                .header("Authorization", "Bearer $t")
                .header("Accept", "application/json")
                .post(requestBody)
                .build()

            client.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string() ?: "{}"
                if (response.isSuccessful) {
                    Result.success(JSONObject(bodyStr))
                } else {
                    Result.failure(IOException("HTTP ${response.code}: $bodyStr"))
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
