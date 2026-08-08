import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AutenticacaoProvedor } from "./contexto/ContextoAutenticacao";
import { RotaProtegida } from "./RotaProtegida";
import { LayoutAutenticado } from "./layout/LayoutAutenticado";
import { TelaCategorias } from "./paginas/TelaCategorias";
import { TelaConfiguracoes } from "./paginas/TelaConfiguracoes";
import { TelaConexoes } from "./paginas/TelaConexoes";
import { TelaContasECartoes } from "./paginas/TelaContasECartoes";
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
            <Route path="/contas" element={<TelaContasECartoes />} />
            <Route path="/cartoes" element={<Navigate to="/contas#cartoes" replace />} />
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
