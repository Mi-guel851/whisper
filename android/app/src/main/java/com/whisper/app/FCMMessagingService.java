package com.whisper.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;
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
 * That fallback is the whole reason whispers buzzed and nothing else did: it was
 * never configuration, just the one path that reached a channel with vibration
 * switched on. ensureChannels() is called at app start so every channel exists
 * before the first push arrives, whether or not this service is involved in
 * showing it.
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
            manager.createNotificationChannel(channel);
        }
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // Token is handled by Capacitor's PushNotifications plugin usually,
        // but we can log it for debugging real-time delivery.
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        // Channels may not exist yet if the process was started by this message
        // rather than by the launcher.
        ensureChannels(this);

        if (remoteMessage.getNotification() != null) {
            String title = remoteMessage.getNotification().getTitle();
            String body = remoteMessage.getNotification().getBody();
            Map<String, String> data = remoteMessage.getData();

            sendNotification(title, body, data.get("type"), conversationIdOf(data));
        } else if (remoteMessage.getData().size() > 0) {
            Map<String, String> data = remoteMessage.getData();
            String title = data.get("title");
            String body = data.get("body");

            if (title != null && body != null) {
                sendNotification(title, body, data.get("type"), conversationIdOf(data));
            }
        }
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

    private void sendNotification(String title, String body, String type, String conversationId) {
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
            url = "whisperapp://feed";
        }

        /* Vibrate here rather than at the top of onMessageReceived. Up there it
           ran even for messages this method then declined to display, and when it
           did display one the channel's own pattern fired too — two buzzes for
           one notification. */
        vibrate();

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setData(Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder notificationBuilder =
                new NotificationCompat.Builder(this, channelId)
                        .setSmallIcon(R.mipmap.ic_launcher)
                        .setContentTitle(title)
                        .setContentText(body)
                        .setAutoCancel(true)
                        // Ignored from Android 8 on, where the channel decides.
                        // Kept for older devices, which have no channels at all.
                        .setVibrate(VIBRATION_PATTERN)
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setDefaults(NotificationCompat.DEFAULT_LIGHTS)
                        .setContentIntent(pendingIntent);

        NotificationManager notificationManager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (notificationManager != null) {
            notificationManager.notify((int) System.currentTimeMillis(), notificationBuilder.build());
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
