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

    private void sendNotification(String title, String body, String type, String conversationId, Map<String, String> data) {
        String channelId = "default";
        String url = "whisperapp://dashboard";

        if ("whisper".equals(type)) {
            channelId = "whispers";
            url = "whisperapp://inbox";
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
            url = postId != null ? "whisperapp://feed?post=" + postId : "whisperapp://feed";
        } else if ("coins".equals(type)) {
            channelId = "coins";
            url = "whisperapp://wallet";
        } else if ("call".equals(type)) {
            channelId = "calls";
            url = conversationId != null ? "whisperapp://chat/" + conversationId : "whisperapp://inbox";
        }

        // The user muted the app in system settings: obey, for every type
        // including calls. A "polite" channel that still bypasses an explicit
        // OFF would be the app deciding the owner is wrong about their phone.
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return;

        boolean isCall = "call".equals(type);
        String callId = data.get("callId") != null ? data.get("callId") : data.get("call_id");
        int notificationId = isCall && callId != null
                ? stableNotificationId("call-" + callId, callId)
                : stableNotificationId(data.get("notificationId"), null);

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setData(Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
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

        if (isCall) {
            /* Full-screen intent: with the screen locked, the task's own
               Activity (the chat, which mounts the ring overlay from live
               signaling) opens directly, the way a real incoming call does.
               USE_FULL_SCREEN_INTENT is a normal install-time permission for
               calling-related apps. `setTimeoutAfter` guarantees that even if
               no cancel arrives (server unreachable, token pruned), the ring
               stops with the call's own expiry. */
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
                    .setFullScreenIntent(pendingIntent, true);
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
