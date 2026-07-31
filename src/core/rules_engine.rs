//! Rules engine for Claude Router
use crate::core::config::Config;
use regex::Regex;

/// Rules engine for determining which role to use
#[derive(Clone)]
pub struct RulesEngine {
    config: Config,
    compiled_rules: Vec<(Regex, String)>,
}

impl RulesEngine {
    /// Create a new rules engine
    pub fn new(config: Config) -> Self {
        let mut compiled_rules = Vec::new();

        // Compile regex patterns from config
        for rule in &config.routing.rules {
            if let Ok(regex) = Regex::new(&rule.pattern) {
                compiled_rules.push((regex, rule.role.clone()));
            }
        }

        Self {
            config,
            compiled_rules,
        }
    }

    /// Select a role based on message content
    pub fn select_role(&self, content: &str) -> String {
        // Check each rule in order
        for (regex, role) in &self.compiled_rules {
            if regex.is_match(content) {
                return role.clone();
            }
        }

        // Return default role if no rules match
        self.config.get_default_role()
    }

    /// Get all available roles
    pub fn get_roles(&self) -> Vec<String> {
        self.config.roles.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_role_selection() {
        // This would require mocking the config
        // let config = Config::load().expect("Failed to load config");
        // let engine = RulesEngine::new(config);
        // assert_eq!(engine.select_role("I need to design an architecture"), "planner");
    }
}