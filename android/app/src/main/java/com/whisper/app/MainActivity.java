package com.whisper.app;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_CODE = 123;
    private ValueCallback<Uri[]> filePathCallback;
    /** Where the camera was told to write. Non-null only for a capture request. */
    private Uri cameraOutputUri;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureScreenPlugin.class);
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        // 1. FORCED FULL SCREEN & TRANSPARENCY
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        WindowCompat.setDecorFitsSystemWindows(window, false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(Color.TRANSPARENT); 
        
        // 2. FILE & CAMERA PICKER SUPPORT
        webView.setWebChromeClient(new WebChromeClient() {
            /*
             * Two <input type="file"> elements in the chat composer, and they have to
             * do different things:
             *
             *   Files  — accept="image/*"                     -> the gallery / documents
             *   Camera — accept="image/*" capture="environment" -> the camera app
             *
             * `fileChooserParams.createIntent()` builds ACTION_GET_CONTENT from the
             * accept types and ignores `capture` entirely, so routing both through it
             * gave both buttons the same picker — the reported "camera button and files
             * button are both opening the same thing".
             *
             * `isCaptureEnabled()` is how the WebView reports that `capture` attribute,
             * so the camera input gets a real ACTION_IMAGE_CAPTURE instead.
             *
             * The output goes to a MediaStore row rather than a FileProvider path: it
             * needs no provider declaration in the manifest, no shared-path XML, and it
             * hands back a content:// URI the WebView can read directly. Without
             * EXTRA_OUTPUT the camera returns a downscaled thumbnail in the extras,
             * which is useless for a photo message.
             */
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, WebChromeClient.FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                MainActivity.this.cameraOutputUri = null;

                if (fileChooserParams.isCaptureEnabled()) {
                    Intent capture = buildCameraIntent();
                    if (capture != null) {
                        try {
                            startActivityForResult(capture, 1001);
                            return true;
                        } catch (Exception e) {
                            // No camera app, or it refused the intent. Fall through to
                            // the picker rather than leaving the button dead.
                            MainActivity.this.cameraOutputUri = null;
                        }
                    }
                }

                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, 1001);
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                MainActivity.this.runOnUiThread(() -> {
                    List<String> grants = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                grants.add(resource);
                            }
                        } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                                grants.add(resource);
                            }
                        }
                    }
                    if (!grants.isEmpty()) {
                        request.grant(grants.toArray(new String[0]));
                    } else {
                        request.deny();
                    }
                });
            }
        });

        // 3. NATIVE PERFORMANCE & FEEL
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setHapticFeedbackEnabled(true);

        /*
         * No drawn scrollbar. The WebView paints its own fading vertical rail on top of
         * the page, independently of CSS, so hiding it in the stylesheet is not enough —
         * a rail sliding down the right edge on every scroll is one of the clearest
         * tells that an app is a website in a shell. Instagram and Facebook draw none.
         * Scrolling itself is untouched; only the indicator goes.
         */
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setScrollbarFadingEnabled(true);

        /*
         * Long-press is suppressed to stop the browser text-selection handles appearing
         * over ordinary UI, which is the other obvious "this is a web page" tell.
         *
         * But it was suppressed *everywhere*, including inside text fields — which is
         * where long-press is the only route to Paste, Select all and the cursor
         * handles. Sending someone a copied link became impossible in the app while
         * working fine on the site.
         *
         * `getHitTestResult()` distinguishes the two: EDIT_TEXT_TYPE is an editable
         * field, so the gesture is handed to the system there and consumed everywhere
         * else. `setLongClickable(false)` is deliberately not set — it would stop this
         * listener from being called at all.
         */
        webView.setOnLongClickListener(v -> {
            WebView.HitTestResult hit = ((WebView) v).getHitTestResult();
            return hit == null || hit.getType() != WebView.HitTestResult.EDIT_TEXT_TYPE;
        });

        // Channels have to exist before the first push lands. FCM posts background
        // notifications itself without ever entering our service, so creating them
        // in there was too late on a fresh install.
        FCMMessagingService.ensureChannels(this);

        requestAppPermissions();
    }

    /**
     * ACTION_IMAGE_CAPTURE pointed at a fresh MediaStore row.
     *
     * Returns null when the row cannot be created, which is the signal to fall back
     * to the ordinary picker — a camera button that opens the gallery is worse than
     * ideal, but a camera button that does nothing at all is a bug.
     */
    private Intent buildCameraIntent() {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "whisper-" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");

            Uri output = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (output == null) return null;

            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, output);
            // The camera is a different process and needs permission to write there.
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (intent.resolveActivity(getPackageManager()) == null) {
                getContentResolver().delete(output, null, null);
                return null;
            }

            cameraOutputUri = output;
            return intent;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != 1001) return;
        if (filePathCallback == null) return;

        Uri[] results;

        if (cameraOutputUri != null) {
            /*
             * A capture. `parseResult` cannot help here: ACTION_IMAGE_CAPTURE returns
             * no data URI when EXTRA_OUTPUT was supplied — the photo is already at the
             * URI we handed it — so the result is read from the field instead.
             *
             * A cancelled capture leaves an empty MediaStore row behind, which would
             * show up in the user's gallery as a 0-byte image. Deleting it is the
             * difference between a clean cancel and litter in their camera roll.
             */
            if (resultCode == RESULT_OK) {
                results = new Uri[] { cameraOutputUri };
            } else {
                try {
                    getContentResolver().delete(cameraOutputUri, null, null);
                } catch (Exception ignored) {
                    // Already gone, or no permission. Nothing useful to do.
                }
                results = null;
            }
            cameraOutputUri = null;
        } else {
            results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        }

        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    private void requestAppPermissions() {
        List<String> permissionsNeeded = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) permissionsNeeded.add(Manifest.permission.POST_NOTIFICATIONS);
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) permissionsNeeded.add(Manifest.permission.READ_MEDIA_IMAGES);
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) permissionsNeeded.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) permissionsNeeded.add(Manifest.permission.CAMERA);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) permissionsNeeded.add(Manifest.permission.RECORD_AUDIO);

        if (!permissionsNeeded.isEmpty()) {
            ActivityCompat.requestPermissions(this, permissionsNeeded.toArray(new String[0]), PERMISSION_REQUEST_CODE);
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