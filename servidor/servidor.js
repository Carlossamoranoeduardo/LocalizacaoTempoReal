require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const crypto = require("node:crypto");
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

app.use(cors());
app.use(express.json({ limit: "25mb" }));;

app.use(express.static(
    path.join(__dirname, "..", "mapa")
));


// ======================================================
// CELULAR CONECTADO
// ======================================================

const aparelhos = new Map();
const LIMITE_APARELHOS = 100;
// ======================================================
// HISTÓRICO DE PERCURSOS
// ======================================================

const pastaHistorico =
    process.env.PASTA_HISTORICO ||
    path.join(__dirname, "historico");

if (!require("fs").existsSync(pastaHistorico)) {
    require("fs").mkdirSync(pastaHistorico, {
        recursive: true
    });
}

async function salvarPontoHistorico(dados) {

    try {

        await pool.query(
            `
            INSERT INTO gps_historico
            (
                aparelho_id,
                latitude,
                longitude,
                precisao,
                horario
            )
            VALUES
            (
                $1,
                $2,
                $3,
                $4,
                $5
            )
            `,
            [
                String(dados.aparelhoId || "desconhecido"),
                Number(dados.latitude),
                Number(dados.longitude),
                Number(dados.precisao),
                new Date(dados.horario || Date.now())
            ]
        );

    } catch (erro) {

        console.error(
            "ERRO AO SALVAR HISTÓRICO NO NEON:",
            erro.message
        );

    }
}
// ======================================================
// TESTE MANUAL DO HISTÓRICO
// ======================================================

app.post("/teste-historico", (req, res) => {

    try {

        const agora = Date.now();

        const pontosTeste = [
            [-20.811000, -49.376000],
            [-20.812000, -49.377000],
            [-20.813000, -49.378000],
            [-20.814000, -49.379000],
            [-20.815000, -49.380000]
        ];

        pontosTeste.forEach((ponto, indice) => {

            salvarPontoHistorico({
                aparelhoId: "TESTE",
                latitude: ponto[0],
                longitude: ponto[1],
                precisao: 5,
                horario: agora + (indice * 10000)
            });

        });

        res.json({
            sucesso: true,
            mensagem: "Pontos de teste gravados",
            quantidade: pontosTeste.length
        });

    } catch (erro) {

        console.error(
            "ERRO NO TESTE:",
            erro
        );

        res.status(500).json({
            sucesso: false,
            erro: erro.message
        });

    }

});

// ======================================================
// STATUS
// ======================================================

app.get("/status", (req, res) => {

    res.json({
    servidor: "online",
    porta: 3000,
    roteirizacao: "OSRM",

    celularConectado:
        [...aparelhos.values()].some(a => a.online),

    quantidadeAparelhos:
        aparelhos.size,

    aparelhosOnline:
        [...aparelhos.values()]
            .filter(a => a.online)
            .length
});

});
// ======================================================
// CONSULTAR HISTÓRICO DE PERCURSO
// ======================================================

app.get(
    "/historico/:aparelhoId/:data",
    async (req, res) => {

        try {

            const aparelhoId =
                String(req.params.aparelhoId);

            const data =
                String(req.params.data);

            if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {

                return res.status(400).json({
                    sucesso: false,
                    erro: "Data inválida. Use YYYY-MM-DD."
                });

            }

            const resultado =
                await pool.query(
                    `
                    SELECT
                        latitude,
                        longitude,
                        precisao,
                        EXTRACT(EPOCH FROM horario) * 1000 AS horario
                    FROM gps_historico
                    WHERE aparelho_id = $1
                      AND (horario AT TIME ZONE 'America/Sao_Paulo')::date = $2::date
                    ORDER BY horario ASC
                    `,
                    [
                        aparelhoId,
                        data
                    ]
                );

            const pontos =
                resultado.rows.map(ponto => ({
                    latitude: Number(ponto.latitude),
                    longitude: Number(ponto.longitude),
                    precisao: Number(ponto.precisao),
                    horario: Number(ponto.horario)
                }));

            res.json({
                sucesso: true,
                aparelhoId: aparelhoId,
                data: data,
                quantidade: pontos.length,
                pontos: pontos
            });

        } catch (erro) {

            console.error(
                "ERRO AO CONSULTAR HISTÓRICO NO NEON:",
                erro.message
            );

            res.status(500).json({
                sucesso: false,
                erro: erro.message
            });

        }

    }
);

// ======================================================
// GEOCODIFICAR
// ======================================================

// ======================================================
// GEOCODIFICAR
// ======================================================

async function geocodificarEndereco(endereco) {

    const original = String(endereco).trim();

    // Remove numeração de lista, se existir
    let limpo = original
        .replace(/^\s*\d+\s*[-.)]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();

    // Separa bairro quando existir:
    // Rua X, 100 — Bairro
    // Rua X, 100 - Bairro
    let logradouro = limpo;
    let bairro = "";

    const separadorBairro = limpo.match(/\s+[—–-]\s+/);

    if (separadorBairro) {

        const partes =
            limpo.split(separadorBairro[0]);

        logradouro = partes[0].trim();
        bairro = partes.slice(1).join(" ").trim();
    }

    // ==================================================
    // TENTATIVAS NOMINATIM
    // ==================================================

    const tentativas = [];

    // Busca original
    tentativas.push(limpo);

    // São José do Rio Preto
    tentativas.push(
        `${limpo}, São José do Rio Preto, SP, Brasil`
    );

    // Logradouro + bairro + cidade
    if (bairro) {

        tentativas.push(
            `${logradouro}, ${bairro}, São José do Rio Preto, SP, Brasil`
        );

        tentativas.push(
            `${logradouro}, ${bairro}, São José do Rio Preto`
        );
    }

    // Somente logradouro + cidade
    tentativas.push(
        `${logradouro}, São José do Rio Preto, SP, Brasil`
    );

    // ==================================================
    // NOMINATIM
    // ==================================================

    for (const busca of tentativas) {

        try {

            console.log(
                "Nominatim:",
                busca
            );

            const resposta =
                await axios.get(
                    "https://nominatim.openstreetmap.org/search",
                    {
                        params: {
                            q: busca,
                            format: "json",
                            addressdetails: 1,
                            limit: 5,
                            countrycodes: "br"
                        },

                        headers: {
                            "User-Agent":
                                "LocalizacaoTempoReal/1.0"
                        },

                        timeout: 15000
                    }
                );

            if (
                resposta.data &&
                resposta.data.length > 0
            ) {

                // Tenta encontrar resultado realmente
                // pertencente a São José do Rio Preto
                let resultado =
                    resposta.data.find(r => {

                        const texto =
                            String(
                                r.display_name || ""
                            ).toLowerCase();

                        return (
                            texto.includes(
                                "são josé do rio preto"
                            ) ||
                            texto.includes(
                                "sao jose do rio preto"
                            )
                        );
                    });

                if (!resultado) {
                    resultado =
                        resposta.data[0];
                }

                return {
                    endereco: original,
                    latitude:
                        Number(resultado.lat),
                    longitude:
                        Number(resultado.lon),
                    encontradoPor:
                        "Nominatim"
                };
            }

        } catch (erro) {

            console.log(
                "Tentativa Nominatim falhou:",
                busca
            );
        }

        // Respeita limite do Nominatim
        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    1100
                )
        );
    }

    // ==================================================
    // PHOTON
    // ==================================================

    for (const busca of tentativas) {

        try {

            console.log(
                "Photon:",
                busca
            );

            const resposta =
                await axios.get(
                    "https://photon.komoot.io/api/",
                    {
                        params: {
                            q: busca,
                            limit: 5
                        },

                        timeout: 15000
                    }
                );

            if (
                resposta.data &&
                resposta.data.features &&
                resposta.data.features.length > 0
            ) {

                let resultado =
                    resposta.data.features.find(
                        feature => {

                            const propriedades =
                                feature.properties || {};

                            const cidade =
                                String(
                                    propriedades.city ||
                                    propriedades.town ||
                                    propriedades.municipality ||
                                    ""
                                ).toLowerCase();

                            return (
                                cidade.includes(
                                    "são josé do rio preto"
                                ) ||
                                cidade.includes(
                                    "sao jose do rio preto"
                                )
                            );
                        }
                    );

                if (!resultado) {
                    resultado =
                        resposta.data.features[0];
                }

                const coordenadas =
                    resultado.geometry.coordinates;

                return {
                    endereco: original,
                    latitude:
                        Number(coordenadas[1]),
                    longitude:
                        Number(coordenadas[0]),
                    encontradoPor:
                        "Photon"
                };
            }

        } catch (erro) {

            console.log(
                "Tentativa Photon falhou:",
                busca
            );
        }
    }

    throw new Error(
        "Endereço não encontrado: " +
        original
    );
}

// ======================================================
// ROTA
// ======================================================

app.post("/rota", async (req, res) => {

    try {

       const enderecos =
    req.body.enderecos;

const latitudeAtual =
    Number(req.body.latitude);

const longitudeAtual =
    Number(req.body.longitude);

console.log(
    "GPS RECEBIDO NA ROTA:",
    latitudeAtual,
    longitudeAtual
);

if (!Array.isArray(enderecos)) {

    return res.status(400).json({
        erro:
            "Envie uma lista de endereços."
    });

}

        const lista =
            enderecos
                .map(e => String(e).trim())
                .filter(e => e.length > 0);


        if (lista.length === 0) {

            return res.status(400).json({
                erro:
                    "Nenhum endereço informado."
            });

        }


        if (
            !Number.isFinite(latitudeAtual) ||
            !Number.isFinite(longitudeAtual)
        ) {

            return res.status(400).json({
                erro:
                    "Localização GPS inválida."
            });

        }


        console.log("");
        console.log(
            "===================================="
        );
        console.log("NOVA ROTA");
        console.log(
            "===================================="
        );

        console.log(
            "Destinos:",
            lista.length
        );


        // ==================================================
        // GEOCODIFICAÇÃO
        // ==================================================

        const destinos = [];


        for (
            let i = 0;
            i < lista.length;
            i++
        ) {

            console.log(
                `Geocodificando ${i + 1}/${lista.length}:`,
                lista[i]
            );


            const destino =
                await geocodificarEndereco(
                    lista[i]
                );


            destino.id = i + 1;

            destinos.push(destino);


            if (i < lista.length - 1) {

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            1100
                        )
                );

            }

        }


        // ==================================================
        // ORIGEM GPS
        // ==================================================

        const origem = {

            id: 0,

            endereco:
                "Localização atual",

            latitude:
                latitudeAtual,

            longitude:
                longitudeAtual

        };


        const pontos = [
            origem,
            ...destinos
        ];


        // ==================================================
        // COORDENADAS
        // ==================================================

        const coordenadas =
            pontos
                .map(
                    p =>
                        `${p.longitude},${p.latitude}`
                )
                .join(";");


        // ==================================================
        // OTIMIZAR
        // ==================================================

        const tripURL =
            "https://router.project-osrm.org/trip/v1/driving/" +
            coordenadas +
            "?source=first" +
            "&destination=last" +
            "&roundtrip=false" +
            "&overview=false";


        console.log(
            "Otimizando ordem..."
        );


        let trip;

try {
    trip = await axios.get(
        tripURL,
        {
            timeout: 120000
        }
    );
} catch (erroOSRM) {
    console.error("====================================");
    console.error("ERRO DETALHADO DO OSRM");
    console.error("URL:", tripURL);
    console.error("STATUS:", erroOSRM.response?.status);
    console.error(
        "RESPOSTA:",
        JSON.stringify(
            erroOSRM.response?.data,
            null,
            2
        )
    );
    console.error("====================================");

    throw new Error(
        "OSRM: " +
        (
            erroOSRM.response?.data?.code ||
            "ERRO"
        ) +
        " - " +
        (
            erroOSRM.response?.data?.message ||
            erroOSRM.message
        )
    );
}


        if (
            !trip.data ||
            trip.data.code !== "Ok"
        ) {

            throw new Error(
                "OSRM não conseguiu organizar os destinos: " +
                (
                    trip.data?.code ||
                    "erro desconhecido"
                )
            );

        }


        const ordem =
    trip.data.waypoints
        .map((w, indiceEntrada) => ({
            indice: indiceEntrada,
            ordem: w.waypoint_index
        }))
        .sort(
            (a, b) =>
                a.ordem - b.ordem
        );

const ordenados =
    ordem.map(
        item =>
            pontos[item.indice]
    );
console.log(
    "ORDEM OTIMIZADA:",
    ordenados.map(p => ({
        id: p.id,
        endereco: p.endereco
    }))
);


        // ==================================================
        // ROTA FINAL
        // ==================================================

        const coordenadasFinais =
            ordenados
                .map(
                    p =>
                        `${p.longitude},${p.latitude}`
                )
                .join(";");


        const routeURL =
            "https://router.project-osrm.org/route/v1/driving/" +
            coordenadasFinais +
            "?overview=full" +
            "&geometries=geojson" +
            "&steps=true";


        console.log(
            "Calculando rota pelas ruas..."
        );


        const route =
            await axios.get(
                routeURL,
                {
                    timeout: 120000
                }
            );


        if (
            !route.data ||
            route.data.code !== "Ok"
        ) {

            throw new Error(
                "Não foi possível calcular a rota."
            );

        }


        const rota =
            route.data.routes[0];


        console.log("");
        console.log(
            "ROTA CONCLUÍDA"
        );


        // ==================================================
        // RESPOSTA
        // ==================================================

        res.json({

            sucesso: true,

            origem,

            destinos:
                ordenados.filter(
                    p => p.id !== 0
                ),

            quantidade:
                destinos.length,

            distanciaKm:
                rota.distance / 1000,

            duracaoHoras:
                rota.duration / 3600,

            distanciaMetros:
                rota.distance,

            duracaoSegundos:
                rota.duration,

            rota:
                rota.geometry,

            etapas:
                rota.legs

        });


    } catch (erro) {

        console.error("");
        console.error(
            "ERRO:",
            erro.message
        );


        res.status(500).json({

            sucesso: false,

            erro:
                erro.message

        });

    }

});


// ======================================================
// ENVIAR ROTA PARA CELULAR
// ======================================================

// ======================================================
// ROTAS COMPARTILHADAS PARA MOTORISTA
// ======================================================

const pastaRotasCompartilhadas =
    path.join(__dirname, "rotas_compartilhadas");

if (!require("fs").existsSync(pastaRotasCompartilhadas)) {

    require("fs").mkdirSync(
        pastaRotasCompartilhadas,
        {
            recursive: true
        }
    );

}


// ======================================================
// CRIAR LINK DA ROTA
// ======================================================

app.post(
    "/criar-rota-compartilhada",
    (req, res) => {

        try {

            const rota =
                req.body;


            if (
                !rota ||
                !rota.origem ||
                !Array.isArray(
                    rota.destinos
                )
            ) {

                return res.status(400).json({

                    sucesso: false,

                    erro:
                        "Dados da rota inválidos."

                });

            }


            const id =
                crypto
                    .randomBytes(8)
                    .toString("hex");


            const criadaEm =
                Date.now();


            let segundosAcumulados = 0;


            const destinos =
                rota.destinos.map(
                    (destino, indice) => {

                        const etapa =
                            Array.isArray(
                                rota.etapas
                            )
                                ? rota.etapas[indice]
                                : null;


                        if (etapa) {

                            segundosAcumulados +=
                                Number(
                                    etapa.duration || 0
                                );

                        }


                        return {

                            id:
                                destino.id ??
                                indice + 1,

                            numero:
                                indice + 1,

                            endereco:
                                destino.endereco || "",

                            latitude:
                                Number(
                                    destino.latitude
                                ),

                            longitude:
                                Number(
                                    destino.longitude
                                ),

                            finalizada:
                                false,

                            finalizadaEm:
                                null,

                            previsaoChegada:
                                criadaEm +
                                (
                                    segundosAcumulados *
                                    1000
                                )

                        };

                    }
                );


            const rotaCompartilhada = {

                id:
                    id,

                criadaEm:
                    criadaEm,

                origem: {

                    latitude:
                        Number(
                            rota.origem.latitude
                        ),

                    longitude:
                        Number(
                            rota.origem.longitude
                        )

                },

                destinos:
                    destinos,

                quantidade:
                    destinos.length,

                distanciaKm:
                    Number(
                        rota.distanciaKm || 0
                    ),

                duracaoSegundos:
                    Number(
                        rota.duracaoSegundos || 0
                    )

            };


            const arquivo =
                path.join(
                    pastaRotasCompartilhadas,
                    `${id}.json`
                );


            require("fs").writeFileSync(

                arquivo,

                JSON.stringify(
                    rotaCompartilhada,
                    null,
                    2
                ),

                "utf8"

            );


            res.json({

                sucesso:
                    true,

                id:
                    id,

                url:
                    `/rota.html?id=${id}`

            });


        } catch (erro) {

            console.error(
                "ERRO AO CRIAR ROTA COMPARTILHADA:",
                erro.message
            );


            res.status(500).json({

                sucesso:
                    false,

                erro:
                    erro.message

            });

        }

    }
);


// ======================================================
// CONSULTAR ROTA COMPARTILHADA
// ======================================================

app.get(
    "/rota-compartilhada/:id",
    (req, res) => {

        try {

            const id =
                String(
                    req.params.id
                )
                .replace(
                    /[^a-zA-Z0-9_-]/g,
                    ""
                );


            if (!id) {

                return res.status(400).json({

                    sucesso:
                        false,

                    erro:
                        "ID da rota inválido."

                });

            }


            const arquivo =
                path.join(
                    pastaRotasCompartilhadas,
                    `${id}.json`
                );


            if (
                !require("fs").existsSync(
                    arquivo
                )
            ) {

                return res.status(404).json({

                    sucesso:
                        false,

                    erro:
                        "Rota não encontrada."

                });

            }


            const rota =
                JSON.parse(
                    require("fs").readFileSync(
                        arquivo,
                        "utf8"
                    )
                );


            res.json({

                sucesso:
                    true,

                rota:
                    rota

            });


        } catch (erro) {

            console.error(
                "ERRO AO CONSULTAR ROTA:",
                erro.message
            );


            res.status(500).json({

                sucesso:
                    false,

                erro:
                    erro.message

            });

        }

    }
);


// ======================================================
// FINALIZAR ENTREGA
// ======================================================

app.post(
    "/rota-compartilhada/:id/finalizar/:entregaId",
    (req, res) => {

        try {

            const id =
                String(
                    req.params.id
                )
                .replace(
                    /[^a-zA-Z0-9_-]/g,
                    ""
                );


            const entregaId =
                String(
                    req.params.entregaId
                );


            const arquivo =
                path.join(
                    pastaRotasCompartilhadas,
                    `${id}.json`
                );


            if (
                !require("fs").existsSync(
                    arquivo
                )
            ) {

                return res.status(404).json({

                    sucesso:
                        false,

                    erro:
                        "Rota não encontrada."

                });

            }


            const rota =
                JSON.parse(
                    require("fs").readFileSync(
                        arquivo,
                        "utf8"
                    )
                );


            const entrega =
                rota.destinos.find(
                    destino =>
                        String(
                            destino.id
                        ) ===
                        entregaId
                );


            if (!entrega) {

                return res.status(404).json({

                    sucesso:
                        false,

                    erro:
                        "Entrega não encontrada."

                });

            }


            entrega.finalizada =
                true;


            entrega.finalizadaEm =
                Date.now();


            require("fs").writeFileSync(

                arquivo,

                JSON.stringify(
                    rota,
                    null,
                    2
                ),

                "utf8"

            );


            const pendentes =
                rota.destinos.filter(
                    destino =>
                        !destino.finalizada
                ).length;


            res.json({

                sucesso:
                    true,

                entregaId:
                    entrega.id,

                pendentes:
                    pendentes,

                finalizadas:
                    rota.destinos.length -
                    pendentes

            });


        } catch (erro) {

            console.error(
                "ERRO AO FINALIZAR ENTREGA:",
                erro.message
            );


            res.status(500).json({

                sucesso:
                    false,

                erro:
                    erro.message

            });

        }

    }
);

app.post(
    "/enviar-rota",
    (req, res) => {

        const conectados =
    [...aparelhos.values()]
        .filter(
            aparelho =>
                aparelho.online &&
                aparelho.socket
        );

if (conectados.length === 0) {

    return res.status(503).json({

        sucesso: false,

        erro:
            "Nenhum celular conectado."

    });

}


        const rota =
            req.body;


        if (
            !rota ||
            !rota.origem ||
            !Array.isArray(
                rota.destinos
            )
        ) {

            return res.status(400).json({

                sucesso: false,

                erro:
                    "Dados da rota inválidos."

            });

        }


        conectados.forEach(
    aparelho => {

        aparelho.socket.emit(
            "receberRota",
            rota
        );

    }
);


        console.log(
            "ROTA ENVIADA PARA CELULAR"
        );


        res.json({

            sucesso: true,

            mensagem:
                "Rota enviada para o celular."

        });

    }
);


// ======================================================
// SOCKET
// ======================================================

// ======================================================
// SOCKET — MÚLTIPLOS APARELHOS
// ======================================================

io.on(
    "connection",
    socket => {

        console.log(
            "Cliente conectado:",
            socket.id
        );

        // Envia para o mapa os aparelhos já cadastrados
        socket.emit(
            "listaAparelhos",
            [...aparelhos.values()].map(
                aparelho => ({
                    aparelhoId: aparelho.aparelhoId,
                    nome: aparelho.nome,
                    latitude: aparelho.latitude,
                    longitude: aparelho.longitude,
                    precisao: aparelho.precisao,
                    horario: aparelho.horario,
                    online: aparelho.online
                })
            )
        );

        // ==================================================
        // REGISTRAR APARELHO
        // ==================================================

        socket.on(
            "registrarCelular",
            dados => {

                const aparelhoId =
                    String(
                        dados?.aparelhoId ||
                        socket.id
                    );

                const nome =
                    String(
                        dados?.nome ||
                        `Celular ${aparelhos.size + 1}`
                    ).trim();

                let aparelho =
                    aparelhos.get(aparelhoId);

                // Limite de 100 aparelhos
                if (
                    !aparelho &&
                    aparelhos.size >= LIMITE_APARELHOS
                ) {

                    socket.emit(
                        "erroAparelho",
                        {
                            erro:
                                `Limite de ${LIMITE_APARELHOS} aparelhos atingido.`
                        }
                    );

                    return;
                }

                // Novo aparelho
                if (!aparelho) {

                    aparelho = {
                        aparelhoId: aparelhoId,
                        nome: nome,
                        socket: socket,

                        latitude: null,
                        longitude: null,
                        precisao: null,
                        horario: null,

                        online: true
                    };

                    aparelhos.set(
                        aparelhoId,
                        aparelho
                    );

                } else {

                    // Aparelho já existente reconectou
                    aparelho.nome = nome;
                    aparelho.socket = socket;
                    aparelho.online = true;
                }

                console.log(
                    "CELULAR REGISTRADO:",
                    aparelhoId,
                    nome
                );

                socket.emit(
                    "statusCelular",
                    {
                        conectado: true,
                        aparelhoId: aparelhoId,
                        nome: nome
                    }
                );

                // Avisar o mapa
                io.emit(
                    "aparelhoAtualizado",
                    {
                        aparelhoId: aparelho.aparelhoId,
                        nome: aparelho.nome,
                        latitude: aparelho.latitude,
                        longitude: aparelho.longitude,
                        precisao: aparelho.precisao,
                        horario: aparelho.horario,
                        online: true
                    }
                );
            }
        );

        // ==================================================
        // GPS
        // ==================================================

        socket.on(
            "localizacao",
            dados => {

                const latitude =
                    Number(
                        dados?.latitude
                    );

                const longitude =
                    Number(
                        dados?.longitude
                    );

                const precisao =
                    Number(
                        dados?.precisao
                    );

                if (
                    !Number.isFinite(latitude) ||
                    !Number.isFinite(longitude)
                ) {
                    return;
                }

                const aparelhoId =
                    String(
                        dados?.aparelhoId ||
                        socket.id
                    );

                let aparelho =
                    aparelhos.get(aparelhoId);

                // Se o aparelho ainda não estiver
                // registrado, cria automaticamente.
                if (!aparelho) {

                    if (
                        aparelhos.size >=
                        LIMITE_APARELHOS
                    ) {

                        console.log(
                            "LIMITE DE APARELHOS ATINGIDO"
                        );

                        return;
                    }

                    aparelho = {

                        aparelhoId: aparelhoId,

                        nome:
                            String(
                                dados?.nome ||
                                `Celular ${aparelhos.size + 1}`
                            ),

                        socket: socket,

                        latitude: null,
                        longitude: null,
                        precisao: null,
                        horario: null,

                        online: true
                    };

                    aparelhos.set(
                        aparelhoId,
                        aparelho
                    );
                }

                // Atualiza os dados desse aparelho
                aparelho.socket = socket;

                aparelho.latitude =
                    latitude;

                aparelho.longitude =
                    longitude;

                aparelho.precisao =
                    precisao;

                aparelho.horario =
    Date.now();

aparelho.online =
    true;

salvarPontoHistorico({
    aparelhoId: aparelho.aparelhoId,
    latitude: latitude,
    longitude: longitude,
    precisao: precisao,
    horario: aparelho.horario
});

console.log(
    `GPS [${aparelho.nome}]: ${latitude}, ${longitude} | precisão: ${precisao}m`
);

                // Envia somente os dados identificados
                // desse aparelho para todos os mapas.
                io.emit(
                    "atualizarLocalizacao",
                    {
                        aparelhoId:
                            aparelho.aparelhoId,

                        nome:
                            aparelho.nome,

                        latitude:
                            latitude,

                        longitude:
                            longitude,

                        precisao:
                            precisao,

                        horario:
                            aparelho.horario,

                        online:
                            true
                    }
                );
            }
        );

        // ==================================================
        // DESCONECTAR
        // ==================================================

        socket.on(
            "disconnect",
            () => {

                console.log(
                    "Cliente desconectado:",
                    socket.id
                );

                // Procura qual aparelho pertencia
                // a este Socket.
                for (
                    const aparelho
                    of aparelhos.values()
                ) {

                    if (
                        aparelho.socket === socket
                    ) {

                        // Não apaga o aparelho.
                        // Apenas marca como offline.
                        aparelho.online =
                            false;

                        aparelho.socket =
                            null;

                        // Avisar o mapa
                        io.emit(
                            "aparelhoAtualizado",
                            {
                                aparelhoId:
                                    aparelho.aparelhoId,

                                nome:
                                    aparelho.nome,

                                latitude:
                                    aparelho.latitude,

                                longitude:
                                    aparelho.longitude,

                                precisao:
                                    aparelho.precisao,

                                horario:
                                    aparelho.horario,

                                online:
                                    false
                            }
                        );

                    }
                }
            }
        );

    }
);


// ======================================================
// SERVIDOR
// ======================================================
server.listen(
    process.env.PORT || 3000,
    "0.0.0.0",
    () => {

        console.log("");

        console.log(
            "===================================="
        );

        console.log(
            " SERVIDOR DE LOCALIZACAO"
        );

        console.log(
            "===================================="
        );

        console.log(
            "http://localhost:3000"
        );

        console.log(
            "http://192.168.10.114:3000"
        );

        console.log(
            "===================================="
        );

    }
);