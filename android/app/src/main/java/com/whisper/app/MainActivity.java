package com.whisper.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_CODE = 123;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureScreenPlugin.class);
        // Plugin will be auto-registered by Capacitor
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        // Edge-to-edge
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WebView webView = getBridge().getWebView();

        // Disable long-press context menu (kills the "website feel")
        webView.setOnLongClickListener(v -> true);
        webView.setLongClickable(false);

        // Disable overscroll glow effect
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // Request Notification permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST_CODE);
            }
        }

        // Custom WebChromeClient to handle microphone rationale
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                        requestMicrophonePermission(request);
                        return;
                    }
                }
                request.grant(request.getResources());
            }
        });
    }

    private void requestMicrophonePermission(PermissionRequest request) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            // In a real production app, you'd show a native dialog here first as rationale.
            // For now, we'll trigger the system prompt.
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, 101);
            // WebView permission needs to be handled after result. Simplifying for now.
            request.deny();
        }
    }

    @Override
    public void onStart() {
        super.onNewIntent(getIntent());
        super.onStart();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}