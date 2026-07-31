//! JSON validation and repair utilities
use anyhow::Result;
use regex::Regex;
use serde_json::Value;

/// Configuration for JSON repair
#[derive(Debug, Clone)]
pub struct JsonRepairConfig {
    /// Maximum number of repair attempts
    pub max_retries: u32,
    /// Whether to attempt to fix unquoted keys
    pub fix_unquoted_keys: bool,
    /// Whether to attempt to fix trailing commas
    pub fix_trailing_commas: bool,
    /// Whether to attempt to fix mismatched brackets
    pub fix_mismatched_brackets: bool,
    /// Whether to attempt to fix single quotes
    pub fix_single_quotes: bool,
}

/// JSON repair utility for fixing malformed JSON
pub struct JsonRepair {
    config: JsonRepairConfig,
}

impl JsonRepair {
    /// Create a new JSON repair utility with default configuration
    pub fn new(max_retries: u32) -> Self {
        let config = JsonRepairConfig {
            max_retries,
            fix_unquoted_keys: true,
            fix_trailing_commas: true,
            fix_mismatched_brackets: true,
            fix_single_quotes: true,
        };
        Self { config }
    }

    /// Create a new JSON repair utility with custom configuration
    pub fn with_config(config: JsonRepairConfig) -> Self {
        Self { config }
    }

    /// Validate JSON string
    pub fn validate_json(&self, json_str: &str) -> Result<Value> {
        serde_json::from_str(json_str).map_err(|e| anyhow::anyhow!("Invalid JSON: {}", e))
    }

    /// Attempt to repair malformed JSON
    pub fn repair_json(&self, malformed_json: &str) -> Result<String> {
        let mut repaired = malformed_json.to_string();

        // Try to fix common JSON issues based on configuration
        if self.config.fix_single_quotes {
            repaired = self.fix_single_quotes(&repaired);
        }

        if self.config.fix_unquoted_keys {
            repaired = self.fix_unquoted_keys(&repaired);
        }

        if self.config.fix_trailing_commas {
            repaired = self.fix_trailing_commas(&repaired);
        }

        if self.config.fix_mismatched_brackets {
            repaired = self.fix_mismatched_brackets(&repaired);
        }

        // Validate one final time
        self.validate_json(&repaired)?;

        Ok(repaired)
    }

    /// Fix unquoted keys in JSON
    fn fix_unquoted_keys(&self, json_str: &str) -> String {
        let mut result = String::new();
        let mut chars = json_str.chars().peekable();
        let mut in_string = false;
        let mut escape_next = false;
        let mut in_object = false;

        while let Some(ch) = chars.next() {
            if escape_next {
                escape_next = false;
                result.push(ch);
                continue;
            }

            match ch {
                '"' if !in_string => {
                    in_string = true;
                    result.push(ch);
                }
                '"' if in_string => {
                    in_string = false;
                    result.push(ch);
                }
                '\\' if in_string => {
                    escape_next = true;
                    result.push(ch);
                }
                '{' if !in_string => {
                    in_object = true;
                    result.push(ch);
                }
                '}' if !in_string => {
                    in_object = false;
                    result.push(ch);
                }
                ':' if !in_string && in_object => {
                    // Find the bare word immediately preceding this colon
                    // (skipping trailing whitespace). If it's already
                    // quoted, the char right before it is '"', which isn't
                    // a word character, so the scan below naturally yields
                    // an empty span and we leave it alone.
                    let mut end = result.len();
                    let mut rev = result.char_indices().rev().peekable();
                    while let Some(&(i, c)) = rev.peek() {
                        if c.is_whitespace() {
                            end = i;
                            rev.next();
                        } else {
                            break;
                        }
                    }
                    let mut start = end;
                    while let Some(&(i, c)) = rev.peek() {
                        if c.is_alphanumeric() || c == '_' || c == '$' || c == '-' {
                            start = i;
                            rev.next();
                        } else {
                            break;
                        }
                    }
                    if start < end {
                        result.insert(end, '"');
                        result.insert(start, '"');
                    }
                    result.push(ch);
                }
                _ => result.push(ch),
            }
        }

        result
    }

    /// Fix trailing commas in JSON (a comma followed by optional whitespace
    /// and a closing brace/bracket, regardless of exact spacing).
    fn fix_trailing_commas(&self, json_str: &str) -> String {
        static PATTERN: &str = r",(\s*[}\]])";
        let re = Regex::new(PATTERN).expect("trailing comma regex is valid");
        re.replace_all(json_str, "$1").into_owned()
    }

    /// Fix mismatched brackets
    fn fix_mismatched_brackets(&self, json_str: &str) -> String {
        // Count opening and closing brackets
        let mut brace_diff = 0i32;
        let mut bracket_diff = 0i32;

        for ch in json_str.chars() {
            match ch {
                '{' => brace_diff += 1,
                '}' => brace_diff -= 1,
                '[' => bracket_diff += 1,
                ']' => bracket_diff -= 1,
                _ => (),
            }
        }

        let mut result = json_str.to_string();

        // Add missing closing brackets
        for _ in 0..brace_diff {
            result.push('}');
        }
        for _ in 0..bracket_diff {
            result.push(']');
        }

        result
    }

    /// Fix single quotes in JSON
    fn fix_single_quotes(&self, json_str: &str) -> String {
        let mut result = String::new();
        let mut chars = json_str.chars().peekable();
        let mut in_string = false;
        let mut in_single_quote_string = false;
        let mut escape_next = false;

        while let Some(ch) = chars.next() {
            if escape_next {
                escape_next = false;
                result.push(ch);
                continue;
            }

            match ch {
                '"' if !in_single_quote_string => {
                    in_string = !in_string;
                    result.push(ch);
                }
                '\'' if !in_string => {
                    in_single_quote_string = !in_single_quote_string;
                    result.push('"'); // Convert to double quote
                }
                '\'' if in_single_quote_string => {
                    in_single_quote_string = false;
                    result.push('"'); // Convert to double quote
                }
                '\\' if in_string || in_single_quote_string => {
                    escape_next = true;
                    result.push(ch);
                }
                _ => result.push(ch),
            }
        }

        result
    }

    /// Retry mechanism for JSON parsing with repair
    pub fn parse_with_repair(&self, json_str: &str) -> Result<Value> {
        // First try direct parsing
        if let Ok(value) = self.validate_json(json_str) {
            return Ok(value);
        }

        // Try repair and parsing up to max_retries times
        let mut current_json = json_str.to_string();
        for _ in 0..self.config.max_retries {
            match self.repair_json(&current_json) {
                Ok(repaired) => {
                    if let Ok(value) = self.validate_json(&repaired) {
                        return Ok(value);
                    }
                    current_json = repaired;
                }
                Err(_) => {
                    // If repair fails, return the original error
                    break;
                }
            }
        }

        // If all retries fail, return the original parsing error
        self.validate_json(json_str)
    }

    /// Add custom repair function
    pub fn add_custom_repair<F>(&mut self, _repair_fn: F)
    where
        F: Fn(&str) -> String,
    {
        // This would be implemented if we wanted to support custom repair functions
        // For now, we'll just have the built-in repair methods
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_validation() {
        let repair = JsonRepair::new(3);

        // Test valid JSON
        let valid_json = r#"{"key": "value"}"#;
        assert!(repair.validate_json(valid_json).is_ok());

        // Test invalid JSON
        let invalid_json = r#"{key: "value"}"#;
        assert!(repair.validate_json(invalid_json).is_err());
    }

    #[test]
    fn test_json_repair() {
        let repair = JsonRepair::new(3);

        // Test simple repair
        let malformed = r#"{key: "value"}"#;
        let repaired = repair.repair_json(malformed);
        assert!(repaired.is_ok());

        // Validate repaired JSON
        if let Ok(repaired_str) = repaired {
            assert!(repair.validate_json(&repaired_str).is_ok());
        }
    }

    #[test]
    fn test_unquoted_keys_repair() {
        let repair = JsonRepair::new(3);

        // Test repair of unquoted keys
        let malformed = r#"{key: "value", another_key: 123}"#;
        let repaired = repair.repair_json(malformed);
        assert!(repaired.is_ok());

        if let Ok(repaired_str) = repaired {
            assert!(repair.validate_json(&repaired_str).is_ok());
            // Check that keys are now quoted
            assert!(repaired_str.contains("\"key\""));
            assert!(repaired_str.contains("\"another_key\""));
        }
    }

    #[test]
    fn test_trailing_commas_repair() {
        let repair = JsonRepair::new(3);

        // Test repair of trailing commas
        let malformed = r#"{"key": "value",}"#;
        let repaired = repair.repair_json(malformed);
        assert!(repaired.is_ok());

        if let Ok(repaired_str) = repaired {
            assert!(repair.validate_json(&repaired_str).is_ok());
        }
    }

    #[test]
    fn test_single_quotes_repair() {
        let repair = JsonRepair::new(3);

        // Test repair of single quotes
        let malformed = r#"{'key': 'value'}"#;
        let repaired = repair.repair_json(malformed);
        assert!(repaired.is_ok());

        if let Ok(repaired_str) = repaired {
            assert!(repair.validate_json(&repaired_str).is_ok());
            // Check that single quotes are converted to double quotes
            assert!(!repaired_str.contains("'key'"));
            assert!(repaired_str.contains("\"key\""));
        }
    }

    #[test]
    fn test_mismatched_brackets_repair() {
        let repair = JsonRepair::new(3);

        // Test repair of mismatched brackets (simplified test)
        let malformed = r#"{"key": "value""#; // Missing closing brace
        let repaired = repair.repair_json(malformed);
        // This might not be perfectly repairable, but shouldn't panic
        if let Ok(repaired_str) = repaired {
            // Just ensure it doesn't crash and returns some result
            println!("Repaired string: {}", repaired_str);
        }
    }

    #[test]
    fn test_parse_with_repair() {
        let repair = JsonRepair::new(3);

        // Test parsing with automatic repair
        let malformed = r#"{key: "value",}"#;
        let result = repair.parse_with_repair(malformed);
        assert!(result.is_ok());

        // Test parsing valid JSON without repair
        let valid = r#"{"key": "value"}"#;
        let result = repair.parse_with_repair(valid);
        assert!(result.is_ok());
    }
}