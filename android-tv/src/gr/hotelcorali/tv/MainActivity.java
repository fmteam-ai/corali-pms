package gr.hotelcorali.tv;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;

/** The room's welcome screen, full screen. Hold Back for 3 seconds to open the set-up screen. */
public class MainActivity extends Activity {
    private static final long SETTINGS_HOLD_MS = 3000;
    private static final long RETRY_MS = 20_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private VoiceBridge voice;
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

    /** Open (or return to) the welcome screen from the background: start-up, wake, urgent message (reload at once). */
    static void bringToFront(Context c, boolean reload, boolean wake) {
        Intent i = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                .putExtra("reload", reload)
                .putExtra("wake", wake);
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
        if (getIntent().getBooleanExtra("wake", false)) turnScreenOn();

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(15, 52, 62));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " CoraliTV/1.5");
        // Lets the page open the streaming apps installed on this TV (Apps tab).
        web.addJavascriptInterface(new AppBridge(this), "CoraliTVApp");
        // Assistant tab: voice input through the remote's microphone and answers read aloud.
        voice = new VoiceBridge(this);
        web.addJavascriptInterface(voice, "CoraliTVVoice");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Stay on the hotel's own pages; anything else is ignored on the TV. Frames inside the page (a channel's
                // YouTube player) load normally.
                if (!request.isForMainFrame()) return false;
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
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getBooleanExtra("wake", false)) turnScreenOn();
        // Urgent message: show it now instead of waiting for the screen's next refresh.
        if (intent.getBooleanExtra("reload", false) && !loadedUrl.isEmpty()) web.reload();
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
        WakeService.start(this);
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

    /** Hands the recognised words (or null: nothing heard / cancelled) to the page's Assistant tab. */
    void voiceResult(String text) {
        String arg = text == null ? "null" : JSONObject.quote(text);
        web.evaluateJavascript("window.coraliVoiceResult&&window.coraliVoiceResult(" + arg + ")", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != VoiceBridge.REQUEST_SPEECH) return;
        ArrayList<String> words = resultCode == RESULT_OK && data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        voiceResult(words != null && !words.isEmpty() ? words.get(0) : null);
    }

    @Override
    protected void onDestroy() {
        if (voice != null) voice.shutdown();
        handler.removeCallbacks(retry);
        web.destroy();
        super.onDestroy();
    }

    /** Light the screen when an urgent message asks to turn the TV on (the window also shows over the lock screen). */
    @SuppressWarnings("deprecation")
    private void turnScreenOn() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
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
            // Short press: the page closes what is open (a channel, a form, a tab) or, if nothing is, leave to the TV's
            // home screen. Held for 3 s: staff set-up screen.
            if (event.getAction() == KeyEvent.ACTION_UP) {
                if (event.getEventTime() - event.getDownTime() >= SETTINGS_HOLD_MS) {
                    startActivity(new Intent(this, SetupActivity.class));
                } else {
                    web.evaluateJavascript("(function(){try{return !!(window.coraliBack&&window.coraliBack());}catch(e){return false;}})()", new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String handled) {
                            if (!"true".equals(handled)) moveTaskToBack(true);
                        }
                    });
                }
            }
            return true;
        }
        // Remotes whose microphone / search key reaches the app: open the Assistant tab and listen.
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_SEARCH || code == KeyEvent.KEYCODE_VOICE_ASSIST) {
            if (event.getAction() == KeyEvent.ACTION_UP) web.evaluateJavascript("window.coraliMic&&window.coraliMic()", null);
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
