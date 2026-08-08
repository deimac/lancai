import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AutenticacaoProvedor } from "./contexto/ContextoAutenticacao";
import { RotaProtegida } from "./RotaProtegida";
import { LayoutAutenticado } from "./layout/LayoutAutenticado";
import { TelaCartoes } from "./paginas/TelaCartoes";
import { TelaCategorias } from "./paginas/TelaCategorias";
import { TelaConfiguracoes } from "./paginas/TelaConfiguracoes";
import { TelaConexoes } from "./paginas/TelaConexoes";
import { TelaContas } from "./paginas/TelaContas";
import { TelaDashboard } from "./paginas/TelaDashboard";
import { TelaExtrato } from "./paginas/TelaExtrato";
import { TelaLogin } from "./paginas/TelaLogin";
import { TelaRegras } from "./paginas/TelaRegras";

export function App() {
  return (
    <BrowserRouter>
      <AutenticacaoProvedor>
        <Routes>
          <Route path="/login" element={<TelaLogin />} />
          <Route
            element={
              <RotaProtegida>
                <LayoutAutenticado />
              </RotaProtegida>
            }
          >
            <Route path="/" element={<TelaDashboard />} />
            <Route path="/contas" element={<TelaContas />} />
            <Route path="/cartoes" element={<TelaCartoes />} />
            <Route path="/categorias" element={<TelaCategorias />} />
            <Route path="/regras" element={<TelaRegras />} />
            <Route path="/extrato" element={<TelaExtrato />} />
            <Route path="/conexoes" element={<TelaConexoes />} />
            <Route path="/configuracoes" element={<TelaConfiguracoes />} />
          </Route>
        </Routes>
      </AutenticacaoProvedor>
    </BrowserRouter>
  );
}
