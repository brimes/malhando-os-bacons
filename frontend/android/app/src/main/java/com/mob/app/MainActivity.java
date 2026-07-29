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
            // The keyboard inset is deliberately excluded: the window already
            // resizes for it, and adding it here would shift the layout twice.
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
