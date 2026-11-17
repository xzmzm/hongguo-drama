// SPDX-License-Identifier: GPL-3.0-only
package com.sign.oracle;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Manual service controls only; no exported signing extras or signature-log files. */
public final class MainActivity extends Activity {
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);
        TextView status = new TextView(this);
        status.setText("USB phone signing\nRequires locally supplied matching SDK inputs and the target app installed.\nNo device IDs or signatures are displayed or saved by this bridge.");
        layout.addView(status);
        Button start = new Button(this);
        start.setText("Start service");
        start.setOnClickListener(view -> {
            startForegroundService(new Intent(this, SignService.class));
            status.setText("Service requested. Check the desktop connection for SDK readiness.");
        });
        layout.addView(start);
        Button stop = new Button(this);
        stop.setText("Stop service");
        stop.setOnClickListener(view -> {
            stopService(new Intent(this, SignService.class));
            status.setText("Service stopped.");
        });
        layout.addView(stop);
        setContentView(layout);
    }
}
