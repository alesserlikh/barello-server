import { Router } from 'express'

const companiesRouter = Router()

type MockCompany = {
  inn: string
  name: string
  venueName: string
  companyName: string
  city: string
  address: string
}

const mockCompaniesByInn: Record<string, MockCompany> = {
  '1234567890': {
    inn: '1234567890',
    name: 'Тестовая компания по ИНН 1234567890',
    venueName: 'Бар Руки Вверх',
    companyName: 'ООО Руки Вверх Поставка',
    city: 'Москва',
    address: 'ул. Якиманка, д. 4',
  },

  '9876543210': {
    inn: '9876543210',
    name: 'Тестовая компания по ИНН 9876543210',
    venueName: 'Бар ВиноТрейд',
    companyName: 'ООО ВиноТрейд',
    city: 'Москва',
    address: 'Третьяковский пр-д, д. 18',
  },
}

function getFallbackCompany(inn: string): MockCompany {
  return {
    inn,
    name: `Тестовая компания ${inn}`,
    venueName: `Тестовое заведение ${inn}`,
    companyName: `ООО Тестовый поставщик ${inn}`,
    city: 'Москва',
    address: 'ул. Тестовая, д. 1',
  }
}

companiesRouter.get('/by-inn/:inn', (req, res) => {
  const { inn } = req.params

  const company = mockCompaniesByInn[inn] || getFallbackCompany(inn)

  res.status(200).json({
    ok: true,
    company,
  })
})

export default companiesRouter