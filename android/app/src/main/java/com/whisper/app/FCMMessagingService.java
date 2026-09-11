package com.whisper.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Displays Whisper pushes and owns the notification channels.
 *
 * WHY CHANNELS ARE CREATED FROM MainActivity AND NOT ONLY HERE
 *
 * The FCM SDK calls onMessageReceived for a message carrying a `notification`
 * block only while the app is in the foreground. Backgrounded or killed — the
 * case that matters, because that is when a push is worth sending — the SDK
 * builds and posts the notification itself, and this class never runs. Creating
 * the channels here meant that on a fresh install the channel named in the
 * payload did not exist yet, so Android fell back to FCM's auto-generated
 * "Miscellaneous" channel and whichever vibration that happened to carry.
 *
 * That fallback is the whole reason whispers buzzed and nothing else did: it
 * was never configuration, just the one path that reached a channel with
 * vibration switched on. ensureChannels() is called at app start so every
 * channel exists before the first push arrives, whether or not this service is
 * involved in showing it.
 *
 * WHAT THE CALLS CHANNEL ADDS (202609100005 alongside)
 *
 * `call` payloads are not ordinary banners. While the app is OPEN the
 * IncomingCallOverlay is the call UI and this class only ensures the row is
 * cleared; while the app is BACKGROUNDED or LOCKED, a call push becomes a
 * full-screen-intent notification on a ringing channel: private visibility
 * (lock-screen shows "Whisper — incoming call", not the sender), a 60s
 * display timeout matching the server's ring expiry so a stale "answer me"
 * cannot outlive the call, and a stable id derived from the call_id so the
 * data-only `call_cancel` message the server fires on every terminal
 * transition (answered on another device, declined, hang-up, expiry sweep)
 * can actually find and remove it.
 *
 * HONEST LIMITS, IN THE CODE SO THE NEXT READER DOES NOT RE-LITIGATE THEM:
 * this is a high-priority notification with a full-screen intent, not a
 * system InCallUI. Real "rings over Do-Not-Disturb, appears on the dialer"
 * behavior needs the telecom ConnectionService (+ MANAGE_OWN_CALLS, and the
 * Google Dialer role conversation on 31+), and iOS needs CallKit — a normal
 * web notification cannot deliver either, and pretending otherwise is a
 * broken promise, not a roadmap. The overlay + this channel are the honest
 * maximum for a Capacitor shell without a native telecom plugin.
 *
 * ACTION BUTTONS (20260912 — FCM notification actions)
 *
 * Each notification type carries its own affordances so the user can act
 * without opening the app first:
 *   friend_request: Accept -> /friends?action=accept&id={source_id}
 *                   Decline -> /friends?action=decline&id={source_id}
 *   messages:       Reply   -> /chat/{conversation_id}?reply=true
 *                   View    -> /chat/{conversation_id}
 *   whispers:       View    -> /notifications (or specific whisper deep link)
 *   calls:          Answer  -> /call/{conversation_id}?answer=true&callId=...
 *                   Decline -> end_call_log RPC with outcome=declined (via
 *                              deep link that the JS layer converts to the RPC;
 *                              the native path also attempts a direct REST
 *                              call when a stored session is available, see
 *                              onNotificationResponse below).
 * The edge function (notify-on-notification) adds `android.notification.actions`
 * for the background-display path, and this service builds the identical
 * NotificationCompat actions for the foreground path so both display paths
 * converge on the same intents.
 */
public class FCMMessagingService extends FirebaseMessagingService {

    /** NGL-style double buzz: {delay, vibrate, pause, vibrate}. */
    private static final long[] VIBRATION_PATTERN = {0, 250, 150, 250};

    /** Channel id -> the label a person sees in Android's notification settings. */
    private static final String[][] CHANNELS = {
            {"whispers", "Anonymous whispers"},
            {"messages", "Inbox messages"},
            {"friend_requests", "Friend requests"},
            {"feed", "Public feed"},
            {"coins", "Coins and wallet"},
            {"calls", "Voice calls"},
            {"default", "General"},
    };

    // Action intent strings — declared in AndroidManifest intent-filters so
    // the system can route them even when the app is not running.
    public static final String ACTION_ACCEPT_FRIEND = "com.whisper.app.ACCEPT_FRIEND_REQUEST";
    public static final String ACTION_DECLINE_FRIEND = "com.whisper.app.DECLINE_FRIEND_REQUEST";
    public static final String ACTION_REPLY_MESSAGE = "com.whisper.app.REPLY_MESSAGE";
    public static final String ACTION_VIEW_MESSAGE = "com.whisper.app.VIEW_MESSAGE";
    public static final String ACTION_VIEW_WHISPER = "com.whisper.app.VIEW_WHISPER";
    public static final String ACTION_ANSWER_CALL = "com.whisper.app.ANSWER_CALL";
    public static final String ACTION_DECLINE_CALL = "com.whisper.app.DECLINE_CALL";

    /**
     * Create every channel the edge functions can name. Safe to call repeatedly:
     * re-creating an existing channel only refreshes its label, and never resets
     * a choice the user has made about it.
     */
    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        for (String[] entry : CHANNELS) {
            NotificationChannel channel = new NotificationChannel(
                    entry[0], entry[1], NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Notifications for " + entry[1].toLowerCase());
            channel.enableVibration(true);
            channel.setVibrationPattern(VIBRATION_PATTERN);
            channel.enableLights(true);
            if ("calls".equals(entry[0])) {
                /* A ring should sound like a ring even if the channel is
                   created before anyone touches settings: default system
                   ringtone, alarm-stream attributes, no muting by media volume.
                   DND bypass is deliberately NOT set — it needs
                   ACCESS_NOTIFICATION_POLICY granted by the user, which no
                   whisper app should quietly ask for. */
                channel.setSound(
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                        new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build());
            }
            manager.createNotificationChannel(channel);
        }
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // The Capacitor PushNotifications plugin delivers token registration
        // to the web layer (lib/push/useRegisterPushNotifications.ts), which
        // stores it through the register_device_token RPC. This service never
        // touches the token: not for storage, not for logs.
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        // Channels may not exist yet if the process was started by this message
        // rather than by the launcher.
        ensureChannels(this);

        Map<String, String> data = remoteMessage.getData();

        /* Data-only retractation from the server (end_call_log / expiry sweep —
           202609100005): "the call this banner is ringing for is over". It
           carries no notification block by design; matching on the same stable
           id the original post used is what makes it find its own row. */
        if ("call_cancel".equals(data.get("type"))) {
            String callId = data.get("callId");
            if (callId != null) {
                NotificationManagerCompat.from(this)
                        .cancel(stableNotificationId("call-" + callId, callId));
            }
            return;
        }

        // Also handle action intents that were delivered as data-only messages
        // via notify-on-notification's collapse path (used for Decline->end_call_log)
        if (data.containsKey("action") && data.get("action") != null && data.get("action").startsWith("call_action_")) {
            onNotificationResponse(data.get("action"), data);
            return;
        }

        String title = null;
        String body = null;
        if (remoteMessage.getNotification() != null) {
            title = remoteMessage.getNotification().getTitle();
            body = remoteMessage.getNotification().getBody();
        } else if (!data.isEmpty()) {
            title = data.get("title");
            body = data.get("body");
        }
        if (title == null || body == null) return;

        sendNotification(title, body, data.get("type"), conversationIdOf(data), data);
    }

    /**
     * Handles action button intents — called from notification action PendingIntents
     * that route through this service via Broadcast, and also from AppUrlHandler
     * deep links that carry action query params.
     *
     * Each branch resolves to the correct deep link or server RPC per the spec:
     *  - friend_request Accept/Decline -> /friends?action=...
     *  - messages Reply/View -> /chat/...?reply=true
     *  - whispers View -> /notifications?whisperId=...
     *  - calls Answer -> /call/...?answer=true
     *  - calls Decline -> end_call_log RPC with outcome declined (attempt native
     *    REST call, fallback to deep link that JS will handle)
     */
    public void onNotificationResponse(String action, Map<String, String> data) {
        if (action == null) return;
        String conversationId = conversationIdOf(data);
        String sourceId = data.get("source_id");
        if (sourceId == null) sourceId = data.get("sourceId");
        if (sourceId == null) sourceId = data.get("notificationId");
        String callId = data.get("callId");
        if (callId == null) callId = data.get("call_id");

        Intent intent = null;
        String url = null;

        if (ACTION_ACCEPT_FRIEND.equals(action)) {
            url = "whisperapp://friends?action=accept&id=" + (sourceId != null ? sourceId : "");
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        } else if (ACTION_DECLINE_FRIEND.equals(action)) {
            url = "whisperapp://friends?action=decline&id=" + (sourceId != null ? sourceId : "");
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        } else if (ACTION_REPLY_MESSAGE.equals(action) && conversationId != null) {
            url = "whisperapp://chat/" + conversationId + "?reply=true";
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        } else if (ACTION_VIEW_MESSAGE.equals(action) && conversationId != null) {
            url = "whisperapp://chat/" + conversationId;
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        } else if (ACTION_VIEW_WHISPER.equals(action)) {
            String whisperId = data.get("whisper_id");
            if (whisperId == null) whisperId = sourceId;
            url = "whisperapp://notifications?whisperId=" + (whisperId != null ? whisperId : "");
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        } else if (ACTION_ANSWER_CALL.equals(action) && conversationId != null) {
            // Answer: deep link to call screen with answer=true — the callSession
            // will call end_call_log(answered) explicitly on Accept, not on mount.
            url = "whisperapp://call/" + conversationId + "?answer=true&callId=" + (callId != null ? callId : "");
            // Also include caller prefetch extras so the call screen renders instantly
            if (data.containsKey("caller_name")) {
                url += "&callerName=" + Uri.encode(data.get("caller_name"));
            }
            if (data.containsKey("caller_avatar")) {
                url += "&callerAvatar=" + Uri.encode(data.get("caller_avatar"));
            }
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        } else if (ACTION_DECLINE_CALL.equals(action)) {
            // Decline: preferred path is direct RPC end_call_log with declined,
            // so the call ends even if the app is killed and JS never runs.
            // We fire a best-effort native HTTP call; if no session is stored,
            // the deep link fallback ensures JS will retry when the app opens.
            if (callId != null) {
                tryDeclineViaRest(callId);
                // Cancel the ringing notification immediately
                NotificationManagerCompat.from(this).cancel(stableNotificationId("call-" + callId, callId));
            }
            // Still launch the app to the call screen's declined state for UX
            if (conversationId != null) {
                url = "whisperapp://call/" + conversationId + "?action=decline&callId=" + (callId != null ? callId : "");
            } else {
                url = "whisperapp://dashboard";
            }
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        }

        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            try {
                startActivity(intent);
            } catch (Exception e) {
                // Fallback: try via MainActivity explicitly
                intent.setClass(this, MainActivity.class);
                try { startActivity(intent); } catch (Exception ignored) {}
            }
        }
    }

    /**
     * Best-effort native decline: POST /rest/v1/rpc/end_call_log with
     * outcome declined. Uses the Supabase anon key + any stored access token.
     * If no token is available the request will 401 and the JS layer will
     * retry when the app resumes — which is acceptable, not a failure.
     */
    private void tryDeclineViaRest(String callId) {
        new Thread(() -> {
            try {
                // Retrieve stored session from SharedPreferences if the web layer
                // has synced it via SecureScreenPlugin or similar. We check
                // several possible keys.
                String accessToken = null;
                try {
                    android.content.SharedPreferences prefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
                    accessToken = prefs.getString("supabase.auth.token", null);
                    if (accessToken != null) {
                        // CapacitorStorage stores JSON string; extract access_token
                        JSONObject obj = new JSONObject(accessToken);
                        accessToken = obj.optString("access_token", null);
                        if (accessToken != null && accessToken.isEmpty()) accessToken = null;
                    }
                } catch (Exception ignored) {}
                // If no token, we cannot auth — let JS handle it
                if (accessToken == null) return;
                String supabaseUrl = getStringResource("supabase_url");
                String anonKey = getStringResource("supabase_anon_key");
                if (supabaseUrl == null || anonKey == null) return;
                java.net.URL url = new java.net.URL(supabaseUrl + "/rest/v1/rpc/end_call_log");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("apikey", anonKey);
                conn.setRequestProperty("Authorization", "Bearer " + accessToken);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                String body = new JSONObject().put("p_call_id", callId).put("p_outcome", "declined").toString();
                conn.getOutputStream().write(body.getBytes("UTF-8"));
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception ignored) {}
        }).start();
    }

    private String getStringResource(String name) {
        try {
            int id = getResources().getIdentifier(name, "string", getPackageName());
            if (id != 0) return getString(id);
        } catch (Exception ignored) {}
        return null;
    }

    /**
     * The payload has carried both spellings at different times — the triggers
     * write snake_case for the web routes and camelCase for this intent — so read
     * whichever is present rather than deep-linking to chat/null.
     */
    private String conversationIdOf(Map<String, String> data) {
        String camel = data.get("conversationId");
        return camel != null ? camel : data.get("conversation_id");
    }

    /** One notification per event, addressable later: hash of the stable key. */
    private int stableNotificationId(String preferredKey, String fallbackKey) {
        String key = preferredKey != null ? preferredKey : fallbackKey;
        return key != null ? Math.abs(key.hashCode()) | 0x40000000 : 0;
    }

    /**
     * Translates the server-provided `route` (a web path like `/chat/<id>` or
     * `/public-feed?post=<id>`) into the matching `whisperapp://` deep link.
     * The route wins over the per-type fallbacks below: it is the trigger's
     * own statement of where the tap should land, and it already carries the
     * exact parameters (conversation id, post id) each surface needs.
     * Returns null for anything outside the app's own surfaces — a tap
     * handler that opens an arbitrary string is an open redirect.
     */
    private String urlForRoute(String route) {
        if (route == null || !route.startsWith("/")) return null;
        String path = route.split("[?#]")[0];
        if (path.startsWith("/chat/")) {
            String id = path.substring("/chat/".length());
            return id.isEmpty() ? "whisperapp://inbox" : "whisperapp://chat/" + id;
        }
        if ("/public-feed".equals(path)) {
            String postId = queryParam(route, "post");
            // The feed page highlights ?post=<id>; validated as a uuid by the
            // web-side handler before it is used.
            return postId != null ? "whisperapp://feed?post=" + postId : "whisperapp://feed";
        }
        if ("/friends".equals(path)) return "whisperapp://friends";
        if ("/premium".equals(path) || "/wallet".equals(path) || "/coins".equals(path)) {
            // One wallet, reached as /premium on the web.
            return "whisperapp://wallet";
        }
        if ("/notifications".equals(path)) return "whisperapp://notifications";
        if ("/inbox".equals(path)) return "whisperapp://inbox";
        if ("/dashboard".equals(path)) return "whisperapp://dashboard";
        return null;
    }

    /** Reads one query parameter out of a route without pulling in a URI parser. */
    private String queryParam(String route, String name) {
        int q = route.indexOf('?');
        if (q < 0) return null;
        for (String pair : route.substring(q + 1).split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(name)) {
                return pair.substring(eq + 1);
            }
        }
        return null;
    }

    private void sendNotification(String title, String body, String type, String conversationId, Map<String, String> data) {
        String channelId = "default";
        String url = "whisperapp://dashboard";

        // The payload's own route first (deep link contract: message → its
        // thread, whisper → /notifications, feed → /public-feed?post=…,
        // friend_request → /friends, coins → /premium, call → its thread with
        // the ring overlay). The type switch underneath is the fallback for
        // payloads that predate the route field.
        String routedUrl = urlForRoute(data.get("route"));
        if (routedUrl != null) {
            url = routedUrl;
            if ("whisper".equals(type)) channelId = "whispers";
            else if ("message".equals(type)) channelId = "messages";
            else if ("friend_request".equals(type)) channelId = "friend_requests";
            else if ("feed".equals(type)) channelId = "feed";
            else if ("coins".equals(type)) channelId = "coins";
            else if ("call".equals(type)) channelId = "calls";
        } else if ("whisper".equals(type)) {
            channelId = "whispers";
            url = "whisperapp://notifications";
        } else if ("message".equals(type)) {
            channelId = "messages";
            url = conversationId != null ? "whisperapp://chat/" + conversationId : "whisperapp://inbox";
        } else if ("friend_request".equals(type)) {
            channelId = "friend_requests";
            url = "whisperapp://friends";
        } else if ("feed".equals(type)) {
            channelId = "feed";
            // The feed page highlights ?post=<id>; a bare whisperapp://feed
            // used to land on a /feed route that does not exist.
            String postId = data.get("postId");
            if (postId == null) postId = data.get("post_id");
            url = postId != null ? "whisperapp://feed?post=" + postId : "whisperapp://feed";
        } else if ("coins".equals(type)) {
            channelId = "coins";
            url = "whisperapp://wallet";
        } else if ("call".equals(type)) {
            channelId = "calls";
            url = conversationId != null ? "whisperapp://chat/" + conversationId : "whisperapp://inbox";
            // Enrich URL with pre-fetched caller info for instant call screen render
            if (data.get("caller_name") != null) {
                String sep = url.contains("?") ? "&" : "?";
                url += sep + "callerName=" + Uri.encode(data.get("caller_name"));
                if (data.get("caller_avatar") != null) {
                    url += "&callerAvatar=" + Uri.encode(data.get("caller_avatar"));
                }
            }
            if (data.get("callId") != null || data.get("call_id") != null) {
                String callId = data.get("callId") != null ? data.get("callId") : data.get("call_id");
                String sep = url.contains("?") ? "&" : "?";
                url += sep + "callId=" + Uri.encode(callId);
            }
        }

        // The user muted the app in system settings: obey, for every type
        // including calls. A "polite" channel that still bypasses an explicit
        // OFF would be the app deciding the owner is wrong about their phone.
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return;

        boolean isCall = "call".equals(type);
        String callId = data.get("callId") != null ? data.get("callId") : data.get("call_id");
        String sourceId = data.get("source_id");
        if (sourceId == null) sourceId = data.get("sourceId");
        if (sourceId == null) sourceId = data.get("notificationId");
        int notificationId = isCall && callId != null
                ? stableNotificationId("call-" + callId, callId)
                : stableNotificationId(data.get("notificationId"), null);

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setData(Uri.parse(url));
        // For calls: launch immediately without waiting for app to fully boot — use FLAG_ACTIVITY_NO_ANIMATION + SINGLE_TOP
        if (isCall) {
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        } else {
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, notificationId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder notificationBuilder =
                new NotificationCompat.Builder(this, channelId)
                        .setSmallIcon(R.mipmap.ic_launcher)
                        .setContentTitle(title)
                        .setContentText(body)
                        .setAutoCancel(true)
                        // Ignored from Android 8 on, where the channel decides.
                        // Kept for older devices, which have no channels at all.
                        .setVibrate(VIBRATION_PATTERN)
                        .setPriority(isCall ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
                        .setDefaults(NotificationCompat.DEFAULT_LIGHTS)
                        .setContentIntent(pendingIntent);

        // Add action buttons per type
        addNotificationActions(notificationBuilder, type, conversationId, sourceId, callId, data, notificationId);

        if (isCall) {
            /* Full-screen intent: with the screen locked, the task's own
               Activity (the chat, which mounts the ring overlay from live
               signaling) opens directly, the way a real incoming call does.
               USE_FULL_SCREEN_INTENT is a normal install-time permission for
               calling-related apps. `setTimeoutAfter` guarantees that even if
               no cancel arrives (server unreachable, token pruned), the ring
               stops with the call's own expiry. */
            // Create a separate full-screen intent that launches immediately without animation
            Intent fullScreenIntent = new Intent(Intent.ACTION_VIEW);
            fullScreenIntent.setData(Uri.parse(url));
            fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
            PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(this, notificationId + 1000000, fullScreenIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            notificationBuilder
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setPublicVersion(new NotificationCompat.Builder(this, channelId)
                            .setSmallIcon(R.mipmap.ic_launcher)
                            .setContentTitle("Whisper")
                            .setContentText("Incoming voice call")
                            .build())
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setTimeoutAfter(60_000L)
                    .setFullScreenIntent(fullScreenPendingIntent, true);
        }

        NotificationManager notificationManager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (notificationManager != null) {
            notificationManager.notify(notificationId, notificationBuilder.build());
            /* Vibrate here rather than at the top of onMessageReceived. Up there it
               ran even for messages this method then declined to display, and when it
               did display one the channel's own pattern fired too — two buzzes for
               one notification. */
            if (!isCall) vibrate();
        }
    }

    private void addNotificationActions(NotificationCompat.Builder builder, String type, String conversationId, String sourceId, String callId, Map<String, String> data, int baseId) {
        if (type == null) return;
        
        // Parse actions from data JSON if present (from edge function), otherwise build locally
        String actionsJson = data.get("actions");
        if (actionsJson != null) {
            try {
                JSONArray arr = new JSONArray(actionsJson);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject obj = arr.getJSONObject(i);
                    String title = obj.optString("title", "");
                    String intentStr = obj.optString("intent", "");
                    String actionUrl = obj.optString("action", "");
                    if (title.isEmpty() || intentStr.isEmpty()) continue;
                    Intent actionIntent = new Intent();
                    // Map intent string to our action constants
                    if ("ACCEPT_FRIEND_REQUEST".equals(intentStr)) {
                        actionIntent.setAction(ACTION_ACCEPT_FRIEND);
                    } else if ("DECLINE_FRIEND_REQUEST".equals(intentStr)) {
                        actionIntent.setAction(ACTION_DECLINE_FRIEND);
                    } else if ("REPLY_MESSAGE".equals(intentStr)) {
                        actionIntent.setAction(ACTION_REPLY_MESSAGE);
                    } else if ("VIEW_MESSAGE".equals(intentStr)) {
                        actionIntent.setAction(ACTION_VIEW_MESSAGE);
                    } else if ("VIEW_WHISPER".equals(intentStr)) {
                        actionIntent.setAction(ACTION_VIEW_WHISPER);
                    } else if ("ANSWER_CALL".equals(intentStr)) {
                        actionIntent.setAction(ACTION_ANSWER_CALL);
                    } else if ("DECLINE_CALL".equals(intentStr)) {
                        actionIntent.setAction(ACTION_DECLINE_CALL);
                    } else {
                        actionIntent.setAction(intentStr);
                    }
                    actionIntent.setClass(this, MainActivity.class);
                    actionIntent.setData(Uri.parse(actionUrl));
                    actionIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    // For call answers, add no-animation flags
                    if ("ANSWER_CALL".equals(intentStr)) {
                        actionIntent.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    }
                    // Pass through call metadata as extras for instant handling
                    if (conversationId != null) actionIntent.putExtra("conversationId", conversationId);
                    if (callId != null) actionIntent.putExtra("callId", callId);
                    if (sourceId != null) actionIntent.putExtra("sourceId", sourceId);
                    if (data.get("caller_name") != null) actionIntent.putExtra("caller_name", data.get("caller_name"));
                    if (data.get("caller_avatar") != null) actionIntent.putExtra("caller_avatar", data.get("caller_avatar"));
                    PendingIntent pi = PendingIntent.getActivity(this, baseId + 100 + i, actionIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    builder.addAction(new NotificationCompat.Action.Builder(0, title, pi).build());
                }
                return; // If we parsed JSON, don't also add local fallback
            } catch (Exception ignored) {}
        }

        // Fallback local construction
        if ("friend_request".equals(type)) {
            String src = sourceId != null ? sourceId : "";
            Intent acceptIntent = new Intent(ACTION_ACCEPT_FRIEND);
            acceptIntent.setClass(this, MainActivity.class);
            acceptIntent.setData(Uri.parse("whisperapp://friends?action=accept&id=" + src));
            acceptIntent.putExtra("sourceId", src);
            acceptIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent acceptPi = PendingIntent.getActivity(this, baseId + 1, acceptIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new NotificationCompat.Action.Builder(0, "Accept", acceptPi).build());

            Intent declineIntent = new Intent(ACTION_DECLINE_FRIEND);
            declineIntent.setClass(this, MainActivity.class);
            declineIntent.setData(Uri.parse("whisperapp://friends?action=decline&id=" + src));
            declineIntent.putExtra("sourceId", src);
            declineIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent declinePi = PendingIntent.getActivity(this, baseId + 2, declineIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new NotificationCompat.Action.Builder(0, "Decline", declinePi).build());
        } else if ("message".equals(type) && conversationId != null) {
            Intent replyIntent = new Intent(ACTION_REPLY_MESSAGE);
            replyIntent.setClass(this, MainActivity.class);
            replyIntent.setData(Uri.parse("whisperapp://chat/" + conversationId + "?reply=true"));
            replyIntent.putExtra("conversationId", conversationId);
            replyIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent replyPi = PendingIntent.getActivity(this, baseId + 3, replyIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new NotificationCompat.Action.Builder(0, "Reply", replyPi).build());

            Intent viewIntent = new Intent(ACTION_VIEW_MESSAGE);
            viewIntent.setClass(this, MainActivity.class);
            viewIntent.setData(Uri.parse("whisperapp://chat/" + conversationId));
            viewIntent.putExtra("conversationId", conversationId);
            viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent viewPi = PendingIntent.getActivity(this, baseId + 4, viewIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new NotificationCompat.Action.Builder(0, "View", viewPi).build());
        } else if ("whisper".equals(type)) {
            String whisperId = sourceId != null ? sourceId : "";
            Intent viewIntent = new Intent(ACTION_VIEW_WHISPER);
            viewIntent.setClass(this, MainActivity.class);
            viewIntent.setData(Uri.parse("whisperapp://notifications?whisperId=" + whisperId));
            viewIntent.putExtra("sourceId", whisperId);
            viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent viewPi = PendingIntent.getActivity(this, baseId + 5, viewIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new NotificationCompat.Action.Builder(0, "View", viewPi).build());
        } else if ("call".equals(type) && conversationId != null) {
            String cId = callId != null ? callId : "";
            String callerName = data.get("caller_name");
            String callerAvatar = data.get("caller_avatar");
            Intent answerIntent = new Intent(ACTION_ANSWER_CALL);
            answerIntent.setClass(this, MainActivity.class);
            String answerUrl = "whisperapp://call/" + conversationId + "?answer=true&callId=" + cId;
            if (callerName != null) answerUrl += "&callerName=" + Uri.encode(callerName);
            if (callerAvatar != null) answerUrl += "&callerAvatar=" + Uri.encode(callerAvatar);
            answerIntent.setData(Uri.parse(answerUrl));
            answerIntent.putExtra("conversationId", conversationId);
            answerIntent.putExtra("callId", cId);
            if (callerName != null) answerIntent.putExtra("caller_name", callerName);
            if (callerAvatar != null) answerIntent.putExtra("caller_avatar", callerAvatar);
            answerIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent answerPi = PendingIntent.getActivity(this, baseId + 6, answerIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new NotificationCompat.Action.Builder(0, "Answer", answerPi).build());

            Intent declineIntent = new Intent(ACTION_DECLINE_CALL);
            declineIntent.setClass(this, MainActivity.class);
            declineIntent.setData(Uri.parse("whisperapp://call/" + conversationId + "?action=decline&callId=" + cId));
            declineIntent.putExtra("conversationId", conversationId);
            declineIntent.putExtra("callId", cId);
            declineIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent declinePi = PendingIntent.getActivity(this, baseId + 7, declineIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new NotificationCompat.Action.Builder(0, "Decline", declinePi).build());
        }
    }

    private void vibrate() {
        Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION_PATTERN, -1));
        } else {
            vibrator.vibrate(VIBRATION_PATTERN, -1);
        }
    }
}
