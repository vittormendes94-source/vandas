// EXEMPLO — NÃO TESTADO EM HARDWARE. Ponto de partida para um sensor Wi-Fi próprio (ESP32 + SHT31/SHT4x)
// que envia leituras ao contrato de ingestão (docs/CONTRATO-DE-LEITURAS.md), sem depender de nuvem de terceiros.
// Antes de usar: revise, teste em bancada e use HTTPS com o domínio publicado. Nunca coloque o token no repositório.
//
// Bibliotecas: Adafruit SHT31 (ou SHT4x), WiFi, HTTPClient, WiFiClientSecure.
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <time.h>
#include "Adafruit_SHT31.h"

const char* WIFI_SSID = "SEU_WIFI";
const char* WIFI_PASS = "SUA_SENHA";
const char* INGEST_URL = "https://SEU-DOMINIO.workers.dev/api/v1/ingest/readings";
const char* INGEST_TOKEN = "COLE_O_TOKEN_AQUI";  // guarde fora do controle de versão
const char* SENSOR_ID = "s1";                   // deve existir em Configurações
const uint32_t INTERVAL_S = 300;                // 5 min: compatível com os limites de atraso padrão (15 min)

Adafruit_SHT31 sht = Adafruit_SHT31();

void sendReading(float t, float h) {
  time_t now = time(nullptr);
  struct tm tm; gmtime_r(&now, &tm);
  char ts[25]; strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", &tm);
  char body[256];
  snprintf(body, sizeof(body),
           "{\"source\":\"esp32\",\"readings\":[{\"sensorId\":\"%s\",\"measuredAt\":\"%s\",\"temperatureC\":%.2f,\"humidityPct\":%.2f}]}",
           SENSOR_ID, ts, t, h);
  WiFiClientSecure client;
  client.setInsecure();  // SUBSTITUA por client.setCACert(...) antes de uso real
  HTTPClient http;
  http.begin(client, INGEST_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + INGEST_TOKEN);
  int code = http.POST((uint8_t*)body, strlen(body));
  Serial.printf("POST -> %d\n", code);
  http.end();
}

void setup() {
  Serial.begin(115200);
  sht.begin(0x44);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
  configTime(0, 0, "pool.ntp.org");  // horário UTC correto é essencial para measuredAt
  while (time(nullptr) < 1700000000) delay(300);
}

void loop() {
  float t = sht.readTemperature(), h = sht.readHumidity();
  if (!isnan(t) && !isnan(h)) sendReading(t, h);
  delay(INTERVAL_S * 1000UL);  // para bateria, prefira deep sleep
}
