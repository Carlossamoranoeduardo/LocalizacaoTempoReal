package com.localizacao.tempo;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import io.socket.client.IO;
import io.socket.client.Socket;

public class LocationService extends Service {

    private static final String SERVIDOR =
            "http://192.168.10.114:3000";

    private static final String CHANNEL_ID =
            "localizacao_tempo_real";

    private LocationManager locationManager;

    private LocationListener locationListener;

    private Socket socket;


    @Override
    public void onCreate() {

        super.onCreate();

        criarCanal();

        iniciarNotificacao();

        conectarSocket();

        iniciarGPS();

    }


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

        manager.createNotificationChannel(canal);

    }


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


    private void conectarSocket() {

        try {

            socket =
                    IO.socket(SERVIDOR);


           socket.on(
        Socket.EVENT_CONNECT,
        args -> {

            System.out.println(
                    "Socket conectado"
            );

            socket.emit(
                    "registrarCelular"
            );

        }
);
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


                android.content.SharedPreferences
                        preferencias =
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

            socket.on(
                    Socket.EVENT_DISCONNECT,
                    args -> {

                        System.out.println(
                                "Socket desconectado"
                        );

                    }
            );


            socket.on(
                    Socket.EVENT_CONNECT_ERROR,
                    args -> {

                        System.out.println(
                                "Erro de conexão Socket"
                        );

                    }
            );


            socket.connect();

        } catch (Exception e) {

            e.printStackTrace();

        }

    }


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

            return;

        }


        try {

            locationManager.requestLocationUpdates(

                    LocationManager.GPS_PROVIDER,

                    1000,

                    1,

                    locationListener

            );

        } catch (SecurityException e) {

            e.printStackTrace();

        }

    }


    private void enviarLocalizacao(
            Location location
    ) {

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


            socket.emit(
                    "localizacao",
                    dados
            );


        } catch (Exception e) {

            e.printStackTrace();

        }

    }


    private void tentarReconectar() {

        if (
                socket == null
        ) {

            conectarSocket();

            return;

        }


        if (
                !socket.connected()
        ) {

            socket.connect();

        }

    }


    @Override
    public int onStartCommand(
            Intent intent,
            int flags,
            int startId
    ) {

        return START_STICKY;

    }


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


    @Nullable
    @Override
    public IBinder onBind(
            Intent intent
    ) {

        return null;

    }

}