package com.example.sentrypoc.config;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class HttpClientConfig {

  /**
   * Official Sentry Spring Boot instrumentation customizes RestClient beans built from
   * {@link RestClient.Builder} ({@code SentrySpanRestClientCustomizer}). That attaches
   * {@code sentry-trace}, {@code baggage}, and (when enabled) {@code traceparent}.
   */
  @Bean
  RestClient pythonDownstreamRestClient(
      RestClient.Builder builder,
      @Value("${sentry.poc.downstream-base-url:http://127.0.0.1:8002}") String baseUrl) {
    return builder.baseUrl(baseUrl).build();
  }

  @Bean
  RestClient pythonDownstreamStrictRestClient(
      RestClient.Builder builder,
      @Value("${sentry.poc.downstream-base-url:http://127.0.0.1:8002}") String baseUrl) {
    HttpClient httpClient =
        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
    factory.setReadTimeout(Duration.ofMillis(1000));
    return builder.clone().requestFactory(factory).baseUrl(baseUrl).build();
  }
}
