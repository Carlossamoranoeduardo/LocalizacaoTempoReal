package com.localizacao.tempo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(
            Context context,
            Intent intent) {

        if (!Intent.ACTION_BOOT_COMPLETED.equals(
                intent.getAction())) {
            return;
        }

        SharedPreferences preferencias =
                context.getSharedPreferences(
                        "localizacao",
                        Context.MODE_PRIVATE
                );

        boolean ativo =
                preferencias.getBoolean(
                        "localizacao_ativa",
                        false
                );

        if (!ativo) {
            return;
        }

        Intent servico =
                new Intent(
                        context,
                        LocationService.class
                );

        if (Build.VERSION.SDK_INT >=
                Build.VERSION_CODES.O) {

            context.startForegroundService(
                    servico
            );

        } else {

            context.startService(
                    servico
            );
        }
    }
}