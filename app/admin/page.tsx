"use client";

import { useState } from "react";

export default function AdminPage() {
  const [messages, setMessages] = useState([
    { id: 1, text: "Hello admin 👋", sender: "User1" },
    { id: 2, text: "Test anonymous message", sender: "Anon" },
  ]);

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <h1>Admin Dashboard ⚡</h1>

      <div style={{ marginTop: 20 }}>
        <h2>Messages</h2>

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              padding: 10,
              marginBottom: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
            }}
          >
            <strong>{msg.sender}</strong>
            <p>{msg.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}