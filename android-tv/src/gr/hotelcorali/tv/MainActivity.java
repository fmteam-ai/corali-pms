package gr.hotelcorali.tv;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

/** The room's welcome screen, full screen. Hold Back for 3 seconds to open the set-up screen. */
public class MainActivity extends Activity {
    private static final long SETTINGS_HOLD_MS = 3000;
    private static final long RETRY_MS = 20_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextView offline;
    private String loadedUrl = "";
    private boolean failed;

    private final Runnable retry = new Runnable() {
        @Override
        public void run() {
            failed = false;
            web.reload();
        }
    };

    /** Open (or return to) the welcome screen from the background: start-up, wake, app update. */
    static void bringToFront(Context c) {
        Intent i = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            c.startActivity(i);
        } catch (RuntimeException ignored) {
            // Blocked without "Display over other apps"; the guest can still open Corali TV from the home screen.
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(15, 52, 62));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " CoraliTV/1.0");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Stay on the hotel's own pages; anything else is ignored on the TV.
                Uri target = request.getUrl();
                Uri home = Uri.parse(loadedUrl);
                return target.getHost() == null || !target.getHost().equals(home.getHost());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!failed) offline.setVisibility(View.GONE);
            }
        });

        offline = new TextView(this);
        offline.setText(Prefs.t("Χωρίς σύνδεση στο internet — νέα προσπάθεια σε λίγο…", "No internet connection — trying again shortly…"));
        offline.setTextColor(Color.WHITE);
        offline.setTextSize(24);
        offline.setGravity(Gravity.CENTER);
        offline.setBackgroundColor(Color.rgb(15, 52, 62));
        offline.setVisibility(View.GONE);

        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemBars();
        Prefs prefs = new Prefs(this);
        if (!prefs.configured()) {
            startActivity(new Intent(this, SetupActivity.class));
            return;
        }
        if (prefs.openOnWake()) WakeService.start(this);
        web.onResume();
        if (!prefs.screenUrl().equals(loadedUrl)) {
            loadedUrl = prefs.screenUrl();
            web.loadUrl(loadedUrl);
        } else if (failed) {
            retry.run();
        }
        web.requestFocus();
    }

    @Override
    protected void onPause() {
        web.onPause();
        handler.removeCallbacks(retry);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(retry);
        web.destroy();
        super.onDestroy();
    }

    private void showOffline() {
        failed = true;
        offline.setVisibility(View.VISIBLE);
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_MS);
    }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            // Short press: leave to the TV's home screen. Held for 3 s: staff set-up screen.
            if (event.getAction() == KeyEvent.ACTION_UP) {
                if (event.getEventTime() - event.getDownTime() >= SETTINGS_HOLD_MS) {
                    startActivity(new Intent(this, SetupActivity.class));
                } else {
                    moveTaskToBack(true);
                }
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
