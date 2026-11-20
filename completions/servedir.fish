complete -c servedir -f
complete -c servedir -a '(__fish_complete_directories)' -d 'Directory to serve'
complete -c servedir -l port -r -d 'Localhost port (0 chooses an available port)'
complete -c servedir -l open -d 'Open in your browser'
complete -c servedir -l version -d 'Print version'
complete -c servedir -l licenses -d 'Print bundled open-source licenses'
complete -c servedir -l completions -x -a fish -d 'Print Fish completions'
complete -c servedir -l help -d 'Show help'
