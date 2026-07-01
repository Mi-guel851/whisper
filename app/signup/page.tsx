export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#090014] text-white">
      <div className="w-full max-w-md rounded-2xl bg-white/10 p-8 backdrop-blur-xl">

        <h1 className="text-4xl font-bold mb-6">
          Create Account
        </h1>

        <form className="space-y-4">

          <input
            type="email"
            placeholder="Email"
            className="w-full rounded-xl bg-black/30 p-4 outline-none"
          />

          <input
            type="password"
            placeholder="Password"
            className="w-full rounded-xl bg-black/30 p-4 outline-none"
          />

          <button
            className="w-full rounded-xl bg-cyan-500 p-4 font-bold text-black"
          >
            Create Account
          </button>

        </form>

      </div>
    </main>
  );
}