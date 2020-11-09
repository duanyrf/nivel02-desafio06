import csvParse from 'csv-parse';
import fs from 'fs';
import { getCustomRepository, getRepository, In, Not } from 'typeorm';
import Category from '../models/Category';
import Transaction from '../models/Transaction';
import TransactionsRepository from '../repositories/TransactionsRepository';

interface CSVTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  categoriesRepository = getRepository(Category);

  transactionsRepository = getCustomRepository(TransactionsRepository);

  async execute(filePath: string): Promise<Transaction[]> {
    const contactsReadStream = fs.createReadStream(filePath);

    const parsers = csvParse({
      from_line: 2,
    });

    const transactions: CSVTransaction[] = [];
    const categories: string[] = [];

    const parseCSV = contactsReadStream.pipe(parsers).on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) return;

      categories.push(category);
      transactions.push({ title, type, value, category });
    });

    await new Promise(resolve => parseCSV.on('end', resolve));

    const categoriesInDB = await this.categoriesRepository.find({
      where: { title: In(categories) },
    });

    const newCategoriesTitle = categoriesInDB.map(
      (category: Category) => category.title,
    );

    const newCategoriesToSave = categories
      .filter(category => !newCategoriesTitle.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    const newCategories = this.categoriesRepository.create(
      newCategoriesToSave.map(title => ({ title })),
    );

    await this.categoriesRepository.save(newCategories);

    const allCategories = [...categoriesInDB, ...newCategories];

    const newTransactions = this.transactionsRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: allCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    await this.transactionsRepository.save(newTransactions);

    await fs.promises.unlink(filePath);

    return newTransactions;
  }
}

export default ImportTransactionsService;
