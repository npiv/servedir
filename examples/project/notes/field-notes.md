# Field notes

This file lives one directory below the workspace root. Relative links and images still work.

[Back to the workspace](../README.md#made-for-local-work)

![Local landscape](../landscape.svg)

## A short conversation

```mermaid
sequenceDiagram
    participant You
    participant Browser
    participant Folder
    You->>Browser: Open a document
    Browser->>Folder: Read the file
    Folder-->>Browser: Markdown
    Browser-->>You: A readable page
```
