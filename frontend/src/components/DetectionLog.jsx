function DetectionLog({ logs }) {
  return (
    <div>
      <h2>Detection Logs</h2>
      <ul>
        {logs.map((log, index) => (
          <li key={index}>{log}</li>
        ))}
      </ul>
    </div>
  );
}

export default DetectionLog;