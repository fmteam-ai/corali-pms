package gr.hotelcorali.tv;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;

import java.util.Locale;

/**
 * window.CoraliTVVoice on the welcome page (Assistant tab): speech recognition through the TV remote's microphone
 * (the TV's own voice input, e.g. Google) and reading answers aloud. The recognised text is handed to the page with
 * window.coraliVoiceResult(text or null). The app itself never records audio.
 */
public class VoiceBridge {
    static final int REQUEST_SPEECH = 41;
    private final MainActivity activity;
    private TextToSpeech tts;
    private boolean ttsReady;

    VoiceBridge(MainActivity activity) {
        this.activity = activity;
    }

    private Intent speechIntent(String locale) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        if (locale != null && locale.matches("[a-z]{2}(-[A-Z]{2})?")) {
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, locale);
        }
        return i;
    }

    @JavascriptInterface
    public boolean available() {
        return activity.getPackageManager().queryIntentActivities(speechIntent(null), PackageManager.MATCH_DEFAULT_ONLY).size() > 0;
    }

    /** Opens the TV's voice input; the answer comes back through window.coraliVoiceResult. */
    @JavascriptInterface
    public boolean listen(final String locale) {
        if (!available()) return false;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    activity.startActivityForResult(speechIntent(locale), REQUEST_SPEECH);
                } catch (RuntimeException e) {
                    activity.voiceResult(null);
                }
            }
        });
        return true;
    }

    /** Reads a reply aloud in the guest's language (quietly does nothing if the TV has no voice for it). */
    @JavascriptInterface
    public void speak(final String text, final String locale) {
        if (text == null || text.isEmpty()) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (tts == null) {
                    tts = new TextToSpeech(activity, new TextToSpeech.OnInitListener() {
                        @Override
                        public void onInit(int status) {
                            ttsReady = status == TextToSpeech.SUCCESS;
                            say(text, locale);
                        }
                    });
                } else {
                    say(text, locale);
                }
            }
        });
    }

    @JavascriptInterface
    public void stop() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (tts != null) tts.stop();
            }
        });
    }

    private void say(String text, String locale) {
        if (!ttsReady || tts == null) return;
        if (locale != null && !locale.isEmpty()) tts.setLanguage(Locale.forLanguageTag(locale));
        String clipped = text.length() > 1500 ? text.substring(0, 1500) : text;
        tts.speak(clipped, TextToSpeech.QUEUE_FLUSH, null, "corali-assistant");
    }

    void shutdown() {
        if (tts != null) {
            tts.shutdown();
            tts = null;
        }
    }
}
