package com.localizacao.tempo;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {

    private static final int PEDIR_PERMISSAO = 100;

    private SharedPreferences preferencias;

    private TextView status;
    private TextView rotaInfo;
    private Button botaoLocalizacao;
    private Button botaoGoogleMaps;

    private JSONObject rotaRecebida;

    @Override
    protected void onCreate(Bundle savedInstanceState) {

        super.onCreate(savedInstanceState);

        preferencias =
                getSharedPreferences(
                        "localizacao",
                        MODE_PRIVATE
                );

        criarInterface();

        solicitarPermissoes();

        carregarEstado();

        carregarRota();

    }

    private void criarInterface() {

        LinearLayout layout =
                new LinearLayout(this);

        layout.setOrientation(
                LinearLayout.VERTICAL
        );

        layout.setPadding(
                30,
                30,
                30,
                30
        );

        status =
                new TextView(this);

        status.setTextSize(20);

        status.setGravity(
                Gravity.CENTER
        );

        status.setText(
                "Localização parada"
        );

        layout.addView(status);

        botaoLocalizacao =
                new Button(this);

        botaoLocalizacao.setText(
                "ATIVAR LOCALIZAÇÃO"
        );

        layout.addView(
                botaoLocalizacao
        );

        rotaInfo =
                new TextView(this);

        rotaInfo.setTextSize(17);

        rotaInfo.setPadding(
                0,
                30,
                0,
                20
        );

        rotaInfo.setText(
                "Nenhuma rota recebida."
        );

        layout.addView(
                rotaInfo
        );

        botaoGoogleMaps =
                new Button(this);

        botaoGoogleMaps.setText(
                "ABRIR ROTA COMPLETA NO GOOGLE MAPS"
        );

        botaoGoogleMaps.setEnabled(
                false
        );

        layout.addView(
                botaoGoogleMaps
        );

        setContentView(layout);

        botaoLocalizacao.setOnClickListener(
                v -> alternarLocalizacao()
        );

        botaoGoogleMaps.setOnClickListener(
                v -> abrirRotaGoogleMaps()
        );
    }

    private void solicitarPermissoes() {

        if (Build.VERSION.SDK_INT >= 23) {

            if (
                    checkSelfPermission(
                            Manifest.permission.ACCESS_FINE_LOCATION
                    )
                    != PackageManager.PERMISSION_GRANTED
            ) {

                requestPermissions(
                        new String[]{
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                        },
                        PEDIR_PERMISSAO
                );
            }
        }

        if (
                Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(
                        Manifest.permission.POST_NOTIFICATIONS
                )
                != PackageManager.PERMISSION_GRANTED
        ) {

            requestPermissions(
                    new String[]{
                            Manifest.permission.POST_NOTIFICATIONS
                    },
                    PEDIR_PERMISSAO + 1
            );
        }
    }

    private void alternarLocalizacao() {

        boolean ativo =
                preferencias.getBoolean(
                        "localizacao_ativa",
                        false
                );

        Intent servico =
                new Intent(
                        this,
                        LocationService.class
                );

        if (!ativo) {

            preferencias
                    .edit()
                    .putBoolean(
                            "localizacao_ativa",
                            true
                    )
                    .apply();

            if (Build.VERSION.SDK_INT >= 26) {

                startForegroundService(
                        servico
                );

            } else {

                startService(
                        servico
                );
            }

            status.setText(
                    "Localização ATIVA"
            );

            botaoLocalizacao.setText(
                    "DESATIVAR LOCALIZAÇÃO"
            );

        } else {

            preferencias
                    .edit()
                    .putBoolean(
                            "localizacao_ativa",
                            false
                    )
                    .apply();

            stopService(servico);

            status.setText(
                    "Localização parada"
            );

            botaoLocalizacao.setText(
                    "ATIVAR LOCALIZAÇÃO"
            );
        }
    }

    private void carregarEstado() {

        boolean ativo =
                preferencias.getBoolean(
                        "localizacao_ativa",
                        false
                );

        if (ativo) {

            status.setText(
                    "Localização ATIVA"
            );

            botaoLocalizacao.setText(
                    "DESATIVAR LOCALIZAÇÃO"
            );

        } else {

            status.setText(
                    "Localização parada"
            );

            botaoLocalizacao.setText(
                    "ATIVAR LOCALIZAÇÃO"
            );
        }
    }

    private void carregarRota() {

        String texto =
                preferencias.getString(
                        "rota_recebida",
                        null
                );

        if (
                texto == null ||
                texto.isEmpty()
        ) {

            rotaInfo.setText(
                    "Nenhuma rota recebida."
            );

            botaoGoogleMaps.setEnabled(
                    false
            );

            return;
        }

        try {

            rotaRecebida =
                    new JSONObject(texto);

            JSONArray destinos =
                    rotaRecebida.getJSONArray(
                            "destinos"
                    );

            StringBuilder textoRota =
                    new StringBuilder();

            textoRota.append(
                    "ROTA RECEBIDA\n\n"
            );

            textoRota.append(
                    "Paradas: "
            );

            textoRota.append(
                    destinos.length()
            );

            textoRota.append(
                    "\n\n"
            );

            for (
                    int i = 0;
                    i < destinos.length();
                    i++
            ) {

                JSONObject destino =
                        destinos.getJSONObject(i);

                textoRota.append(
                        i + 1
                );

                textoRota.append(
                        ". "
                );

                textoRota.append(
                        destino.getString(
                                "endereco"
                        )
                );

                textoRota.append(
                        "\n"
                );
            }

            rotaInfo.setText(
                    textoRota.toString()
            );

            botaoGoogleMaps.setEnabled(
                    destinos.length() > 0
            );

        } catch (Exception e) {

            e.printStackTrace();

            rotaInfo.setText(
                    "Erro ao carregar a rota."
            );

            botaoGoogleMaps.setEnabled(
                    false
            );
        }
    }

    private void abrirRotaGoogleMaps() {

        if (rotaRecebida == null) {

            Toast.makeText(
                    this,
                    "Nenhuma rota recebida.",
                    Toast.LENGTH_LONG
            ).show();

            return;
        }

        try {

            JSONArray destinos =
                    rotaRecebida.getJSONArray(
                            "destinos"
                    );

            if (
                    destinos.length() == 0
            ) {

                return;
            }

            /*
             * A primeira parada será o destino
             * intermediário, e a última será o
             * destino final.
             */

            JSONObject primeira =
                    destinos.getJSONObject(0);

            JSONObject ultima =
                    destinos.getJSONObject(
                            destinos.length() - 1
                    );

            double primeiraLat =
                    primeira.getDouble(
                            "latitude"
                    );

            double primeiraLon =
                    primeira.getDouble(
                            "longitude"
                    );

            double ultimaLat =
                    ultima.getDouble(
                            "latitude"
                    );

            double ultimaLon =
                    ultima.getDouble(
                            "longitude"
                    );

            StringBuilder waypoints =
                    new StringBuilder();

            /*
             * Todas as paradas entre a primeira
             * e a última entram como waypoints.
             */

            for (
                    int i = 0;
                    i < destinos.length() - 1;
                    i++
            ) {

                JSONObject destino =
                        destinos.getJSONObject(i);

                if (waypoints.length() > 0) {

                    waypoints.append("|");
                }

                waypoints.append(
                        destino.getDouble(
                                "latitude"
                        )
                );

                waypoints.append(",");

                waypoints.append(
                        destino.getDouble(
                                "longitude"
                        )
                );
            }

            String url =
                    "https://www.google.com/maps/dir/?api=1" +
                    "&origin=" +
                    primeiraLat +
                    "," +
                    primeiraLon +
                    "&destination=" +
                    ultimaLat +
                    "," +
                    ultimaLon +
                    "&waypoints=" +
                    Uri.encode(
                            waypoints.toString()
                    ) +
                    "&travelmode=driving";

            Intent intent =
                    new Intent(
                            Intent.ACTION_VIEW,
                            Uri.parse(url)
                    );

            intent.setPackage(
                    "com.google.android.apps.maps"
            );

            try {

                startActivity(intent);

            } catch (
                    ActivityNotFoundException e
            ) {

                Intent navegador =
                        new Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse(url)
                        );

                startActivity(
                        navegador
                );
            }

        } catch (Exception e) {

            e.printStackTrace();

            Toast.makeText(
                    this,
                    "Erro ao abrir rota no Google Maps.",
                    Toast.LENGTH_LONG
            ).show();
        }
    }

    @Override
    protected void onResume() {

        super.onResume();

        carregarRota();
    }
}