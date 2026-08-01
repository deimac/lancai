import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AutenticacaoProvedor } from "./contexto/ContextoAutenticacao";
import { RotaProtegida } from "./RotaProtegida";
import { TelaLogin } from "./paginas/TelaLogin";
import { TelaPrincipal } from "./paginas/TelaPrincipal";

export function App() {
  return (
    <BrowserRouter>
      <AutenticacaoProvedor>
        <Routes>
          <Route path="/login" element={<TelaLogin />} />
          <Route
            path="/"
            element={
              <RotaProtegida>
                <TelaPrincipal />
              </RotaProtegida>
            }
          />
        </Routes>
      </AutenticacaoProvedor>
    </BrowserRouter>
  );
}
