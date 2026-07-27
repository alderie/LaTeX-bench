// React needs to be told it is running inside a test environment before it
// will accept `act(...)`. Without this every hook test still passes but
// prints "The current testing environment is not configured to support
// act(...)" for each update, which buries real output.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
