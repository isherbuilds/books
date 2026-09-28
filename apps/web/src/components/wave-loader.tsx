type LoaderProps = {
  className?: string;
  label?: string;
};

export function WaveLoader({ className = "", label = "Loading" }: LoaderProps) {
  return (
    <div role="status" aria-label={label} className={`flex items-center gap-0.5 ${className}`}>
      {[...Array(10)].map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-4 w-1 animate-[pulse_1.5s_infinite] bg-primary motion-reduce:animate-none"
          style={{ animationDelay: `${i * 0.1}s` }}
        />
      ))}
    </div>
  );
}
