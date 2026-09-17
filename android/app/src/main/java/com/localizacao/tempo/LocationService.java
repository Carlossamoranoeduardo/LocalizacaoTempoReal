package com.localizacao.tempo;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.util.UUID;

import io.socket.client.IO;
import io.socket.client.Socket;

public class LocationService extends Service {

    private static final String SERVIDOR =
            "https://localizacaotemporeal.onrender.com";

    private static final String CHANNEL_ID =
            "localizacao_tempo_real";

    private LocationManager locationManager;

    private LocationListener locationListener;

    private Socket socket;

    // Identificação deste celular
    private String aparelhoId;
    private String nomeAparelho;


    // =========================================================
    // ON CREATE
    // =========================================================

    @Override
    public void onCreate() {

        super.onCreate();

        criarCanal();

        iniciarNotificacao();

        prepararIdentificacao();

        conectarSocket();

        iniciarGPS();
    }


    // =========================================================
    // IDENTIFICAÇÃO DO APARELHO
    // =========================================================

    private void prepararIdentificacao() {

        SharedPreferences preferencias =
                getSharedPreferences(
                        "localizacao",
                        MODE_PRIVATE
                );

        // Tenta recuperar o ID que já foi criado anteriormente
        aparelhoId =
                preferencias.getString(
                        "aparelho_id",
                        null
                );


        // Se ainda não existe, cria um ID único
        if (aparelhoId == null) {

            aparelhoId =
                    UUID.randomUUID().toString();

            preferencias
                    .edit()
                    .putString(
                            "aparelho_id",
                            aparelhoId
                    )
                    .apply();
        }


        // Nome padrão baseado no modelo do celular
        String nomePadrao =
                android.os.Build.MANUFACTURER
                        + " "
                        + android.os.Build.MODEL;


        nomeAparelho =
                preferencias.getString(
                        "nome_aparelho",
                        nomePadrao
                );


        System.out.println(
                "================================="
        );

        System.out.println(
                "APARELHO ID: " + aparelhoId
        );

        System.out.println(
                "NOME: " + nomeAparelho
        );

        System.out.println(
                "================================="
        );
    }


    // =========================================================
    // CRIAR CANAL DA NOTIFICAÇÃO
    // =========================================================

    private void criarCanal() {

        NotificationChannel canal =
                new NotificationChannel(
                        CHANNEL_ID,
                        "Localização em tempo real",
                        NotificationManager.IMPORTANCE_LOW
                );


        NotificationManager manager =
                getSystemService(
                        NotificationManager.class
                );


        if (manager != null) {

            manager.createNotificationChannel(
                    canal
            );
        }
    }


    // =========================================================
    // NOTIFICAÇÃO DO SERVIÇO
    // =========================================================

    private void iniciarNotificacao() {

        Notification notification =
                new NotificationCompat.Builder(
                        this,
                        CHANNEL_ID
                )
                .setContentTitle(
                        "Localização em tempo real"
                )
                .setContentText(
                        "GPS ativo e enviando localização"
                )
                .setSmallIcon(
                        android.R.drawable.ic_menu_mylocation
                )
                .setOngoing(true)
                .build();


        startForeground(
                1001,
                notification
        );
    }


    // =========================================================
    // CONEXÃO SOCKET.IO
    // =========================================================

    private void conectarSocket() {

        try {

            socket =
                    IO.socket(SERVIDOR);


            // -------------------------------------------------
            // SOCKET CONECTADO
            // -------------------------------------------------

            socket.on(
                    Socket.EVENT_CONNECT,
                    args -> {

                        System.out.println(
                                "Socket conectado"
                        );


                        try {

                            // Envia a identificação deste celular
                            JSONObject registro =
                                    new JSONObject();


                            registro.put(
                                    "aparelhoId",
                                    aparelhoId
                            );


                            registro.put(
                                    "nome",
                                    nomeAparelho
                            );


                            socket.emit(
                                    "registrarCelular",
                                    registro
                            );


                            System.out.println(
                                    "Celular registrado: "
                                            + aparelhoId
                            );


                        } catch (Exception e) {

                            e.printStackTrace();
                        }
                    }
            );


            // -------------------------------------------------
            // RECEBER ROTA
            // -------------------------------------------------

            socket.on(
                    "receberRota",
                    args -> {

                        if (
                                args == null ||
                                args.length == 0
                        ) {

                            return;
                        }


                        try {

                            JSONObject rota =
                                    (JSONObject) args[0];


                            SharedPreferences preferencias =
                                    getSharedPreferences(
                                            "localizacao",
                                            MODE_PRIVATE
                                    );


                            preferencias
                                    .edit()
                                    .putString(
                                            "rota_recebida",
                                            rota.toString()
                                    )
                                    .apply();


                            System.out.println(
                                    "ROTA RECEBIDA NO CELULAR"
                            );


                        } catch (Exception e) {

                            e.printStackTrace();
                        }
                    }
            );


            // -------------------------------------------------
            // SOCKET DESCONECTADO
            // -------------------------------------------------

            socket.on(
                    Socket.EVENT_DISCONNECT,
                    args -> {

                        System.out.println(
                                "Socket desconectado"
                        );
                    }
            );


            // -------------------------------------------------
            // ERRO DE CONEXÃO
            // -------------------------------------------------

            socket.on(
                    Socket.EVENT_CONNECT_ERROR,
                    args -> {

                        System.out.println(
                                "Erro de conexão Socket"
                        );
                    }
            );


            // -------------------------------------------------
            // CONECTAR
            // -------------------------------------------------

            socket.connect();


        } catch (Exception e) {

            e.printStackTrace();
        }
    }


    // =========================================================
    // INICIAR GPS
    // =========================================================

    private void iniciarGPS() {

        locationManager =
                (LocationManager)
                        getSystemService(
                                LOCATION_SERVICE
                        );


        locationListener =
                new LocationListener() {

                    @Override
                    public void onLocationChanged(
                            Location location
                    ) {

                        enviarLocalizacao(
                                location
                        );
                    }
                };


        // Verifica permissão GPS
        if (
                checkSelfPermission(
                        Manifest.permission.ACCESS_FINE_LOCATION
                )
                != PackageManager.PERMISSION_GRANTED
                &&
                checkSelfPermission(
                        Manifest.permission.ACCESS_COARSE_LOCATION
                )
                != PackageManager.PERMISSION_GRANTED
        ) {

            System.out.println(
                    "Permissão de localização não concedida"
            );

            return;
        }


        try {

            locationManager.requestLocationUpdates(

                    LocationManager.GPS_PROVIDER,

                    1000,

                    1,

                    locationListener

            );


            System.out.println(
                    "GPS iniciado"
            );


        } catch (SecurityException e) {

            e.printStackTrace();
        }
    }


    // =========================================================
    // ENVIAR LOCALIZAÇÃO
    // =========================================================

    private void enviarLocalizacao(
            Location location
    ) {

        // Se não estiver conectado, tenta reconectar
        if (
                socket == null ||
                !socket.connected()
        ) {

            tentarReconectar();

            return;
        }


        try {

            JSONObject dados =
                    new JSONObject();


            // -------------------------------------------------
            // IDENTIFICAÇÃO DO APARELHO
            // -------------------------------------------------

            dados.put(
                    "aparelhoId",
                    aparelhoId
            );


            dados.put(
                    "nome",
                    nomeAparelho
            );


            // -------------------------------------------------
            // GPS
            // -------------------------------------------------

            dados.put(
                    "latitude",
                    location.getLatitude()
            );


            dados.put(
                    "longitude",
                    location.getLongitude()
            );


            dados.put(
                    "precisao",
                    location.getAccuracy()
            );


            dados.put(
                    "horario",
                    System.currentTimeMillis()
            );


            // -------------------------------------------------
            // ENVIAR PARA O SERVIDOR
            // -------------------------------------------------

            socket.emit(
                    "localizacao",
                    dados
            );


            System.out.println(
                    "Localização enviada: "
                            + aparelhoId
                            + " | "
                            + location.getLatitude()
                            + " | "
                            + location.getLongitude()
            );


        } catch (Exception e) {

            e.printStackTrace();
        }
    }


    // =========================================================
    // TENTAR RECONEXÃO
    // =========================================================

    private void tentarReconectar() {

        if (socket == null) {

            conectarSocket();

            return;
        }


        if (!socket.connected()) {

            socket.connect();
        }
    }


    // =========================================================
    // START COMMAND
    // =========================================================

    @Override
    public int onStartCommand(
            Intent intent,
            int flags,
            int startId
    ) {

        return START_STICKY;
    }


    // =========================================================
    // DESTRUIR SERVIÇO
    // =========================================================

    @Override
    public void onDestroy() {

        if (
                locationManager != null &&
                locationListener != null
        ) {

            locationManager.removeUpdates(
                    locationListener
            );
        }


        if (socket != null) {

            socket.disconnect();

            socket.close();
        }


        super.onDestroy();
    }


    // =========================================================
    // BIND
    // =========================================================

    @Nullable
    @Override
    public IBinder onBind(
            Intent intent
    ) {

        return null;
    }
}