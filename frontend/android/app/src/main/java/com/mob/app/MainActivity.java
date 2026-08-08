package com.mob.app;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Keeps the web content out from under the system bars.
     *
     * Apps targeting SDK 35 or higher get edge-to-edge enforced by the platform:
     * the activity is laid out behind the status and navigation bars. On iOS the
     * page would compensate through CSS `env(safe-area-inset-*)`, but the Android
     * WebView never populates those — measured as 0px on device even with
     * `viewport-fit=cover` set. So the padding has to come from the native side,
     * otherwise the header sits under the clock and the footer under the nav bar.
     *
     * Opting out with `windowOptOutEdgeToEdgeEnforcement` was the other option and
     * was rejected on purpose: Google treats it as temporary and stops honouring
     * it in a later release, which would bring this bug back on an OS update.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            // The display cutout matters on its own: on a foldable the camera hole
            // is not always covered by the status bar inset.
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());

            // The keyboard has to be padded for here too. It used to be left out,
            // on the assumption that the window resizes for it on its own — it
            // does not, once edge-to-edge is enforced, and returning CONSUMED
            // below means nothing downstream ever hears about the IME either. The
            // measured result on device was the keyboard drawn straight over the
            // page: the field being typed into stayed hidden underneath it.
            //
            // max, not sum: while the keyboard is up it covers the navigation bar,
            // so the IME inset already includes that height. Adding them would
            // leave a gap the size of the nav bar above the keyboard.
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            int bottom = Math.max(bars.bottom, ime.bottom);

            view.setPadding(bars.left, bars.top, bars.right, bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
