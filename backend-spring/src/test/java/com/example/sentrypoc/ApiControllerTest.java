package com.example.sentrypoc;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class ApiControllerTest {

  @Autowired private MockMvc mockMvc;

  @Test
  void health() throws Exception {
    mockMvc
        .perform(get("/health"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.ok").value(true))
        .andExpect(jsonPath("$.service").value("sentry-poc-spring"));
  }

  @Test
  void success() throws Exception {
    mockMvc
        .perform(
            get("/api/success")
                .header("sentry-trace", "1234567890abcdef1234567890abcdef-1234567890abcdef-1")
                .header("traceparent", "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.ok").value(true))
        .andExpect(jsonPath("$.environment").exists())
        .andExpect(jsonPath("$.incoming_trace_headers['sentry-trace']").exists())
        .andExpect(jsonPath("$.active_span").exists());
  }

  @Test
  void uncaughtError() {
    Exception thrown =
        assertThrows(Exception.class, () -> mockMvc.perform(get("/api/error")).andReturn());
    assertTrue(thrown.getMessage().contains("Uncaught Spring Boot exception for Sentry PoC"));
  }

  @Test
  void caughtError() throws Exception {
    mockMvc
        .perform(get("/api/caught-error"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.captured").value(true));
  }

  @Test
  void logAndMetric() throws Exception {
    mockMvc
        .perform(get("/api/log"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.log_channels.framework").value("SLF4J/Logback"))
        .andExpect(jsonPath("$.log_channels.explicit_sentry_logger").value("Sentry.logger()"));
    mockMvc
        .perform(get("/api/metric"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.metrics_emitted").isArray());
  }
}
